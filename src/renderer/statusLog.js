(function () {
  function createStatusLog({ latestStatus, statusList, toggleButton }) {
    toggleButton.addEventListener('click', () => {
      statusList.hidden = !statusList.hidden;
      toggleButton.textContent = statusList.hidden ? '로그 보기' : '로그 숨기기';
    });

    function add(message, level = 'info') {
      latestStatus.textContent = message;
      latestStatus.className = level;

      const item = document.createElement('li');
      item.className = level;
      item.textContent = message;
      statusList.prepend(item);
    }

    return { add };
  }

  window.statusLog = {
    createStatusLog
  };
})();
