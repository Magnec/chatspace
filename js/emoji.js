(function (window, document) {
  'use strict';

  // Orijinal koddaki emoji durumları ve liste aynen taşındı
  let emojiPanelVisible = false;

  const emojiList = [
    "😀", "😁", "😂", "😎", "😏", "😍", "😜", "😇",
    "😭", "😡", "😱", "😅", "🤩", "🥳", "😴", "🥺",
    "🤔", "🤓", "🧐", "😋", "😬", "😐", "🤯", "😢",
    "👍", "👏", "🙏", "💪", "💯", "🔥", "🎉", "🎁"
  ];

  // Orijinal setupEmojiPicker() fonksiyonu aynen taşındı
  function setupEmojiPicker() {
    const panel = document.getElementById('emoji-picker-panel');
    const toggleButton = document.getElementById('emoji-picker-toggle');
    
    if (!panel || !toggleButton) return;

    panel.style.display = 'none';
    panel.innerHTML = '';
    
    emojiList.forEach((emoji, index) => {
      const span = document.createElement('span');
      span.textContent = emoji;
      span.dataset.emoji = emoji;
      span.className = 'emoji-item';
      span.style.cssText = `
        cursor: pointer;
        font-size: 1.5em;
        padding: 6px;
        border-radius: 6px;
        transition: background 0.15s ease;
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 32px;
        background: transparent;
      `;
      panel.appendChild(span);
    });

    document.addEventListener('click', function(e) {
      if (e.target && e.target.id === 'emoji-picker-toggle') {
        e.preventDefault();
        e.stopPropagation();
        
        const currentPanel = document.getElementById('emoji-picker-panel');
        emojiPanelVisible = !emojiPanelVisible;
        
        if (emojiPanelVisible) {
          currentPanel.style.cssText = `
            display: grid !important;
            position: absolute !important;
            bottom: 75px !important;
            left: 0 !important;
            background: #252832 !important;
            border: 1px solid #343948 !important;
            border-radius: 12px !important;
            box-shadow: 0 4px 24px rgba(0,0,0,0.25) !important;
            padding: 5px !important;
            grid-template-columns: repeat(7, 1fr) !important;
            gap: 5px !important;
            z-index: 2 !important;
            visibility: visible !important;
            opacity: 1 !important;
          `;
        } else {
          currentPanel.style.display = 'none';
        }
        return false;
      }
      
      if (e.target && e.target.className === 'emoji-item') {
        e.preventDefault();
        e.stopPropagation();
        
        const emoji = e.target.dataset.emoji || e.target.textContent;
        const input = document.getElementById('chat-message-input');
        
        if (input) {
          const cursorPos = input.selectionStart || input.value.length;
          const textBefore = input.value.substring(0, cursorPos);
          const textAfter = input.value.substring(cursorPos);
          
          const newValue = textBefore + emoji + textAfter;
          input.value = newValue;
          
          const newPos = cursorPos + emoji.length;
          setTimeout(() => {
            input.focus();
            input.setSelectionRange(newPos, newPos);
          }, 10);
          
          const currentPanel = document.getElementById('emoji-picker-panel');
          currentPanel.style.display = 'none';
          emojiPanelVisible = false;
        }
        return false;
      }
      
      const currentPanel = document.getElementById('emoji-picker-panel');
      if (emojiPanelVisible && currentPanel && 
          !currentPanel.contains(e.target) && 
          e.target.id !== 'emoji-picker-toggle') {
        currentPanel.style.display = 'none';
        emojiPanelVisible = false;
      }
    }, true);

    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape' && emojiPanelVisible) {
        const currentPanel = document.getElementById('emoji-picker-panel');
        if (currentPanel) {
          currentPanel.style.display = 'none';
          emojiPanelVisible = false;
        }
      }
    });
  }

  // Global olarak erişilebilir kıl (ana dosya setupEmojiPicker() çağırıyor)
  window.setupEmojiPicker = setupEmojiPicker;

})(window, document);