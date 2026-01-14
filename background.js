const api = typeof browser !== 'undefined' ? browser : chrome;
const isBrowser = typeof browser !== 'undefined';

const DEFAULT_STATE = {
  courses: [],
  intervalSeconds: 30,
  monitoring: false,
  logs: [],
  lastAvailability: {},
  lastCheck: null,
  theme: 'light',
  checkUrl: 'https://rds3.northsouth.edu/'
};

const storage = {
  get(keys) {
    return isBrowser
      ? api.storage.local.get(keys)
      : new Promise((resolve) => api.storage.local.get(keys, resolve));
  },
  set(data) {
    return isBrowser
      ? api.storage.local.set(data)
      : new Promise((resolve) => api.storage.local.set(data, resolve));
  }
};

const withTimeout = (promise, ms, message) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

const getState = async () => {
  const state = await storage.get(DEFAULT_STATE);
  const merged = { ...DEFAULT_STATE, ...state };
  if (!merged.intervalSeconds && merged.intervalMinutes) {
    merged.intervalSeconds = merged.intervalMinutes * 60;
    delete merged.intervalMinutes;
    await storage.set({ intervalSeconds: merged.intervalSeconds });
  }
  return merged;
};

const addLog = async (message, type = 'info') => {
  const state = await getState();
  const entry = {
    timestamp: new Date().toISOString(),
    message,
    type
  };
  const nextLogs = [entry, ...state.logs].slice(0, 50);
  await storage.set({ logs: nextLogs });
};

let checkTimerId = null;

const scheduleChecks = async (intervalSeconds) => {
  if (checkTimerId) {
    clearInterval(checkTimerId);
    checkTimerId = null;
  }
  checkTimerId = setInterval(checkCourses, intervalSeconds * 1000);
};

const notifyAvailability = async (courseLabel) => {
  const message = `Seats available for ${courseLabel}.`;
  const options = {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'NSU Advising Assistant',
    message
  };

  if (isBrowser) {
    await api.notifications.create(`${Date.now()}`, options);
  } else {
    api.notifications.create(`${Date.now()}`, options);
  }
};

const createTab = async (url) => {
  if (isBrowser) {
    return api.tabs.create({ url, active: false });
  }

  return new Promise((resolve, reject) => {
    api.tabs.create({ url, active: false }, (tab) => {
      const error = api.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(tab);
    });
  });
};

const waitForTabComplete = async (tabId) => {
  if (isBrowser) {
    return new Promise((resolve) => {
      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === 'complete') {
          api.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      api.tabs.onUpdated.addListener(listener);
    });
  }

  return new Promise((resolve) => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        api.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    api.tabs.onUpdated.addListener(listener);
  });
};

const sendMessageToTab = async (tabId, payload) => {
  if (isBrowser) {
    return api.tabs.sendMessage(tabId, payload);
  }

  return new Promise((resolve, reject) => {
    api.tabs.sendMessage(tabId, payload, (response) => {
      const error = api.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
};

const removeTab = async (tabId) => {
  if (isBrowser) {
    await api.tabs.remove(tabId);
  } else {
    api.tabs.remove(tabId);
  }
};

let isChecking = false;

const checkCourses = async () => {
  if (isChecking) {
    return;
  }
  isChecking = true;

  try {
    const state = await getState();
    if (!state.courses.length) {
      await addLog('No courses configured for monitoring.', 'warning');
      return;
    }

    await addLog('Starting seat availability check...', 'info');

    const tab = await createTab(state.checkUrl);
    let response = null;

    try {
      await waitForTabComplete(tab.id);
      response = await withTimeout(
        sendMessageToTab(tab.id, { action: 'checkSeats', courses: state.courses }),
        15000,
        'Timed out waiting for seat availability response.'
      );
    } finally {
      await removeTab(tab.id);
    }

    if (!response || response.error) {
      await addLog(response?.error || 'No data returned from content script.', 'error');
      return;
    }

    const newAvailability = { ...state.lastAvailability };
    const results = response.results || [];

    results.forEach((result) => {
      newAvailability[result.key] = result.available;
    });

    await storage.set({
      lastAvailability: newAvailability,
      lastCheck: new Date().toISOString()
    });

    const availableCourses = results.filter((result) => result.available);
    if (!availableCourses.length) {
      await addLog('No seats found in monitored courses.', 'info');
    }

    for (const result of results) {
      const wasAvailable = state.lastAvailability[result.key];
      if (result.available && !wasAvailable) {
        await notifyAvailability(result.label);
        await addLog(`Seats available for ${result.label}.`, 'success');
      } else if (!result.available) {
        await addLog(`No seats for ${result.label}.`, 'info');
      }
    }
  } catch (error) {
    await addLog(`Error while checking seats: ${error.message}`, 'error');
  } finally {
    isChecking = false;
  }
};

const startMonitoring = async (intervalSeconds) => {
  const state = await getState();
  const nextInterval = intervalSeconds || state.intervalSeconds;
  await storage.set({ monitoring: true, intervalSeconds: nextInterval });
  await scheduleChecks(nextInterval);
  await addLog(`Monitoring started. Checks every ${nextInterval} seconds.`, 'success');
  await checkCourses();
};

const stopMonitoring = async () => {
  if (checkTimerId) {
    clearInterval(checkTimerId);
    checkTimerId = null;
  }
  await storage.set({ monitoring: false });
  await addLog('Monitoring stopped.', 'warning');
};

const addCourse = async (course) => {
  const state = await getState();
  const code = course.code.trim().toUpperCase();
  const section = course.section ? course.section.trim() : '';
  const key = `${code}|${section}`;

  if (state.courses.some((item) => item.key === key)) {
    await addLog(`Course ${code} already in list.`, 'warning');
    return;
  }

  const nextCourses = [
    ...state.courses,
    {
      key,
      code,
      section
    }
  ];
  await storage.set({ courses: nextCourses });
  await addLog(`Added course ${code}${section ? ` (${section})` : ''}.`, 'success');
};

const removeCourse = async (courseKey) => {
  const state = await getState();
  const nextCourses = state.courses.filter((course) => course.key !== courseKey);
  await storage.set({ courses: nextCourses });
  await addLog('Removed course from monitoring list.', 'warning');
};

api.runtime.onMessage.addListener((message) => {
  if (!message || !message.action) {
    return;
  }

  if (message.action === 'addCourse') {
    addCourse(message.course);
  }

  if (message.action === 'removeCourse') {
    removeCourse(message.courseKey);
  }

  if (message.action === 'startMonitoring') {
    startMonitoring(message.intervalSeconds);
  }

  if (message.action === 'stopMonitoring') {
    stopMonitoring();
  }

  if (message.action === 'checkNow') {
    checkCourses();
  }
});

api.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  if (!state.intervalSeconds && state.intervalMinutes) {
    state.intervalSeconds = state.intervalMinutes * 60;
    delete state.intervalMinutes;
  }
  await storage.set(state);
  if (state.monitoring) {
    await scheduleChecks(state.intervalSeconds);
  }
});
