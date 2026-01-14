(() => {
  const normalize = (value) => value.replace(/\s+/g, '').toUpperCase();

  const parseSeatCount = (cells, seatIndex) => {
    if (Number.isInteger(seatIndex) && seatIndex >= 0 && seatIndex < cells.length) {
      const parsed = Number.parseInt(cells[seatIndex].replace(/[^0-9]/g, ''), 10);
      return Number.isNaN(parsed) ? null : parsed;
    }

    const numbers = cells
      .map((cell) => Number.parseInt(cell.replace(/[^0-9]/g, ''), 10))
      .filter((number) => !Number.isNaN(number));

    return numbers.length ? numbers[numbers.length - 1] : null;
  };

  const findSeatIndex = (table) => {
    const headerCells = table.querySelectorAll('thead th');
    if (!headerCells.length) {
      return null;
    }

    const labels = Array.from(headerCells).map((cell) => cell.textContent.trim().toLowerCase());
    const seatIndex = labels.findIndex((label) => label.includes('seat') || label.includes('available'));
    return seatIndex === -1 ? null : seatIndex;
  };

  const collectRows = () => {
    return Array.from(document.querySelectorAll('table tr'));
  };

  const checkCourses = (courses) => {
    const rows = collectRows();
    const results = [];

    courses.forEach((course) => {
      const courseKey = course.key || `${course.code}|${course.section || ''}`;
      const normalizedCode = normalize(course.code || '');
      const normalizedSection = normalize(course.section || '');
      let matchedRow = null;
      let seatIndex = null;

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td, th')).map((cell) => cell.textContent.trim());
        if (!cells.length) {
          continue;
        }

        const rowText = normalize(cells.join(' '));
        if (!rowText.includes(normalizedCode)) {
          continue;
        }

        if (normalizedSection) {
          const hasSection = cells.some((cell) => normalize(cell) === normalizedSection);
          if (!hasSection) {
            continue;
          }
        }

        matchedRow = cells;
        const table = row.closest('table');
        if (table) {
          seatIndex = findSeatIndex(table);
        }
        break;
      }

      if (!matchedRow) {
        results.push({
          key: courseKey,
          label: course.section ? `${course.code} (${course.section})` : course.code,
          available: false,
          seats: null,
          note: 'Course not found on page.'
        });
        return;
      }

      const seats = parseSeatCount(matchedRow, seatIndex);
      const available = seats !== null ? seats > 0 : false;

      results.push({
        key: courseKey,
        label: course.section ? `${course.code} (${course.section})` : course.code,
        available,
        seats,
        note: seats === null ? 'Unable to parse seat count.' : 'Parsed from page.'
      });
    });

    return results;
  };

  const handleMessage = (message, sender, sendResponse) => {
    if (!message || message.action !== 'checkSeats') {
      return;
    }

    try {
      const results = checkCourses(message.courses || []);
      sendResponse({ results, url: window.location.href });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  };

  if (typeof browser !== 'undefined') {
    browser.runtime.onMessage.addListener((message, sender) => {
      return new Promise((resolve) => {
        handleMessage(message, sender, resolve);
      });
    });
  } else {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      handleMessage(message, sender, sendResponse);
      return true;
    });
  }
})();
