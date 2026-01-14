(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const isBrowser = typeof browser !== 'undefined';

  const DEFAULT_STATE = {
    courses: [],
    intervalSeconds: 30,
    monitoring: false,
    logs: [],
    lastCheck: null,
    theme: 'light'
  };

  const elements = {
    courseCode: document.getElementById('courseCode'),
    courseSection: document.getElementById('courseSection'),
    addCourse: document.getElementById('addCourse'),
    courseList: document.getElementById('courseList'),
    courseEmpty: document.getElementById('courseEmpty'),
    courseError: document.getElementById('courseError'),
    intervalSeconds: document.getElementById('intervalSeconds'),
    startMonitoring: document.getElementById('startMonitoring'),
    stopMonitoring: document.getElementById('stopMonitoring'),
    checkNow: document.getElementById('checkNow'),
    monitoringStatus: document.getElementById('monitoringStatus'),
    intervalStatus: document.getElementById('intervalStatus'),
    lastCheckStatus: document.getElementById('lastCheckStatus'),
    activityLog: document.getElementById('activityLog'),
    activityEmpty: document.getElementById('activityEmpty'),
    themeToggle: document.getElementById('themeToggle')
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

  const runtimeSend = (message) => {
    return isBrowser
      ? api.runtime.sendMessage(message)
      : new Promise((resolve) => api.runtime.sendMessage(message, resolve));
  };

  const formatCourseLabel = (course) => {
    if (!course.section) {
      return course.code;
    }
    return `${course.code} • ${course.section}`;
  };

  const formatTimestamp = (isoString) => {
    if (!isoString) {
      return 'Never';
    }
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  const setTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
  };

  const renderCourses = (courses) => {
    elements.courseList.innerHTML = '';

    if (!courses.length) {
      elements.courseEmpty.classList.remove('hidden');
      return;
    }

    elements.courseEmpty.classList.add('hidden');
    courses.forEach((course) => {
      const listItem = document.createElement('li');
      listItem.textContent = formatCourseLabel(course);

      const removeButton = document.createElement('button');
      removeButton.className = 'remove-btn';
      removeButton.type = 'button';
      removeButton.textContent = '×';
      removeButton.addEventListener('click', () => {
        runtimeSend({ action: 'removeCourse', courseKey: course.key });
      });

      listItem.appendChild(removeButton);
      elements.courseList.appendChild(listItem);
    });
  };

  const renderLogs = (logs) => {
    elements.activityLog.innerHTML = '';

    if (!logs.length) {
      elements.activityEmpty.classList.remove('hidden');
      return;
    }

    elements.activityEmpty.classList.add('hidden');
    logs.forEach((log) => {
      const item = document.createElement('li');
      item.className = log.type || '';
      item.textContent = `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.message}`;
      elements.activityLog.appendChild(item);
    });
  };

  const renderStatus = (state) => {
    if (document.activeElement !== elements.intervalSeconds) {
      elements.intervalSeconds.value = state.intervalSeconds;
    }
    elements.intervalStatus.textContent = `${state.intervalSeconds} sec`;
    elements.monitoringStatus.textContent = state.monitoring ? 'Running' : 'Stopped';
    elements.monitoringStatus.classList.toggle('monitoring', state.monitoring);
    elements.monitoringStatus.classList.toggle('not-monitoring', !state.monitoring);
    elements.lastCheckStatus.textContent = formatTimestamp(state.lastCheck);
    setTheme(state.theme || 'light');
    renderCourses(state.courses);
    renderLogs(state.logs);
  };

  const updateMonitoringStatus = (monitoring) => {
    elements.monitoringStatus.textContent = monitoring ? 'Running' : 'Stopped';
    elements.monitoringStatus.classList.toggle('monitoring', monitoring);
    elements.monitoringStatus.classList.toggle('not-monitoring', !monitoring);
  };

  const updateIntervalStatus = (intervalSeconds) => {
    if (document.activeElement !== elements.intervalSeconds) {
      elements.intervalSeconds.value = intervalSeconds;
    }
    elements.intervalStatus.textContent = `${intervalSeconds} sec`;
  };

  const loadState = async () => {
    const state = await storage.get(DEFAULT_STATE);
    const merged = { ...DEFAULT_STATE, ...state };
    if (!merged.intervalSeconds && merged.intervalMinutes) {
      merged.intervalSeconds = merged.intervalMinutes * 60;
      delete merged.intervalMinutes;
      await storage.set({ intervalSeconds: merged.intervalSeconds });
    }
    return merged;
  };

  const addCourse = async () => {
    elements.courseError.textContent = '';
    const code = elements.courseCode.value.trim().toUpperCase();
    const section = elements.courseSection.value.trim();

    if (!code) {
      elements.courseError.textContent = 'Please enter a course code.';
      return;
    }

    await runtimeSend({
      action: 'addCourse',
      course: {
        code,
        section
      }
    });

    elements.courseCode.value = '';
    elements.courseSection.value = '';
    elements.courseCode.focus();
  };

  const startMonitoring = async () => {
    const intervalSeconds = Number.parseInt(elements.intervalSeconds.value, 10);
    if (Number.isNaN(intervalSeconds) || intervalSeconds < 1) {
      elements.courseError.textContent = 'Interval must be at least 1 second.';
      return;
    }

    await runtimeSend({ action: 'startMonitoring', intervalSeconds });
  };

  const stopMonitoring = async () => {
    await runtimeSend({ action: 'stopMonitoring' });
  };

  const checkNow = async () => {
    await runtimeSend({ action: 'checkNow' });
  };

  const toggleTheme = async () => {
    const current = await loadState();
    const nextTheme = current.theme === 'dark' ? 'light' : 'dark';
    await storage.set({ theme: nextTheme });
    setTheme(nextTheme);
  };

  let currentState = { ...DEFAULT_STATE };

  const init = async () => {
    currentState = await loadState();
    renderStatus(currentState);

    elements.addCourse.addEventListener('click', addCourse);
    elements.courseCode.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        addCourse();
      }
    });
    elements.courseSection.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        addCourse();
      }
    });
    elements.startMonitoring.addEventListener('click', startMonitoring);
    elements.stopMonitoring.addEventListener('click', stopMonitoring);
    elements.checkNow.addEventListener('click', checkNow);
    elements.themeToggle.addEventListener('click', toggleTheme);

    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') {
        return;
      }
      if (changes.intervalSeconds) {
        currentState.intervalSeconds = changes.intervalSeconds.newValue;
        updateIntervalStatus(currentState.intervalSeconds);
      }
      if (changes.monitoring) {
        currentState.monitoring = changes.monitoring.newValue;
        updateMonitoringStatus(currentState.monitoring);
      }
      if (changes.lastCheck) {
        currentState.lastCheck = changes.lastCheck.newValue;
        elements.lastCheckStatus.textContent = formatTimestamp(currentState.lastCheck);
      }
      if (changes.courses) {
        currentState.courses = changes.courses.newValue || [];
        renderCourses(currentState.courses);
      }
      if (changes.logs) {
        currentState.logs = changes.logs.newValue || [];
        renderLogs(currentState.logs);
      }
      if (changes.theme) {
        currentState.theme = changes.theme.newValue;
        setTheme(currentState.theme || 'light');
      }
    });
  };

  init();
})();
