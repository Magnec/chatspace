(function (Drupal, drupalSettings) {
  'use strict';

  Drupal.behaviors.chatSpace = {
    attach: function(context, settings) {
      // Container tespiti ve işleme alınması
      const containers = context.querySelectorAll ? context.querySelectorAll('#chat-space-container:not([data-chat-processed])') : [];
      if (containers.length === 0 && context.querySelector) {
        const singleContainer = context.querySelector('#chat-space-container');
        if (singleContainer && !singleContainer.hasAttribute('data-chat-processed')) {
          containers[0] = singleContainer;
        }
      }
      if (containers.length === 0) {
        const container = document.getElementById('chat-space-container');
        if (container && !container.hasAttribute('data-chat-processed')) {
          initializeChat(container);
        }
        return;
      }
      Array.from(containers).forEach(function(container) {
        if (container && container.dataset.roomId) {
          initializeChat(container);
        }
      });

      function initializeChat(container) {
        container.setAttribute('data-chat-processed', 'true');

        let currentRoomId = container.dataset.roomId;
        let emojiPanelVisible = false;
        let lastMessageId = 0;
        let userTypingTimeout = null;
        let isTyping = false;
        let typingUsers = new Set();
        let heartbeatInterval = null;
        let lastUserActivity = Date.now();
        let sendingMessage = false;
        let isTabActive = true;

        let messageRefreshRunning = false;
        let userRefreshRunning = false;
        let currentPollingInterval = 300;
        let lastMessageTime = Date.now();
        let consecutiveEmptyPolls = 0;

        const POLLING_FAST = 200;
        const POLLING_NORMAL = 500;
        const POLLING_SLOW = 1000;
        const POLLING_IDLE = 2000;

        const emojiList = [
          "😀", "😁", "😂", "😎", "😏", "😍", "😜", "😇",
          "😭", "😡", "😱", "😅", "🤩", "🥳", "😴", "🥺",
          "🤔", "🤓", "🧐", "😋", "😬", "😐", "🤯", "😢",
          "👍", "👏", "🙏", "💪", "💯", "🔥", "🎉", "🎁"
        ];

        let originalTitle = document.title;

        function scrollToBottom(animated = true, force = false) {
          const msgPanel = document.getElementById('chat-messages');
          if (msgPanel) {
            if (animated) {
              msgPanel.scrollTo({
                top: msgPanel.scrollHeight,
                behavior: 'smooth'
              });
            } else {
              msgPanel.scrollTop = msgPanel.scrollHeight;
            }
          }
        }

        function renderUserList(users) {
          const userlist = document.querySelector('.userlist-list');
          if (!userlist) return;
          userlist.innerHTML = '';
          if (!users || users.length === 0) {
            userlist.innerHTML = '<li><span>Kimse yok</span></li>';
            return;
          }
          users.forEach(user => {
            const li = document.createElement('li');
            const isCurrentUser = user.uid == drupalSettings.user?.uid;
            const onlineClass = user.is_online ? 'user-online' : 'user-offline';
            const currentUserClass = isCurrentUser ? 'current-user' : '';
            li.className = `userlist-item ${onlineClass} ${currentUserClass}`;
            li.innerHTML = `
              <div class="user-avatar-container">
                <img src="${escapeHtml(user.avatar)}" loading="lazy" alt="Avatar" />
                <span class="user-status-dot ${user.is_online ? 'online' : 'offline'}"></span>
              </div>
              <div class="user-info">
                <span class="userlist-name">${escapeHtml(user.name)}</span>
                <span class="user-status">${user.is_online ? 'Çevrimiçi' : user.last_seen || 'Çevrimdışı'}</span>
              </div>
            `;
            if (typingUsers.has(user.uid)) {
              const typingDiv = document.createElement('div');
              typingDiv.className = 'user-typing';
              typingDiv.innerHTML = '<span>yazıyor...</span>';
              li.appendChild(typingDiv);
            }
            userlist.appendChild(li);
          });
        }

        function fetchUsers() {
          if (userRefreshRunning) return;
          userRefreshRunning = true;
          const token = drupalSettings.chatSpace && drupalSettings.chatSpace.token ? drupalSettings.chatSpace.token : '';
          fetch(`/chat-space/${currentRoomId}/users?t=${Date.now()}`, {
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              'X-CSRF-Token': token
            }
          })
            .then(r => {
              if (!r.ok) {
                return r.text().then(text => {
                  throw new Error(`HTTP ${r.status}: ${text}`);
                });
              }
              return r.json();
            })
            .then(data => {
              if (data.users) {
                renderUserList(data.users);
                updateUserCount(data.users.length);
              }
            })
            .catch(() => {
              renderUserList([]);
            })
            .finally(() => {
              userRefreshRunning = false;
            });
        }

        function updateUserCount(count) {
          const header = document.querySelector('.userlist-header .user-count');
          if (header) header.textContent = `(${count})`;
          const toggleButton = document.getElementById('mobile-user-toggle');
          if (toggleButton) {
            const toggleText = toggleButton.querySelector('.toggle-text');
            if (toggleText) {
              const baseText = toggleButton.classList.contains('active') ? 'Gizle' : 'Kullanıcılar';
              toggleText.textContent = `${baseText} (${count})`;
            }
          }
        }

        function renderMessages(messages, reset = false) {
          const msgPanel = document.getElementById('chat-messages');
          if (!msgPanel) return;
          if (reset) {
            msgPanel.innerHTML = '';
            lastMessageId = 0;
          }
          let hasNewMessages = false;
          let newMessagesFromOthers = false;
          messages.forEach(msg => {
            if (document.querySelector(`[data-message-id="${msg.message_id}"]`)) {
              return;
            }
            const div = document.createElement('div');
            div.className = 'chat-message-bubble';
            div.dataset.messageId = msg.message_id;
            const isCurrentUser = msg.uid == drupalSettings.user?.uid;
            const messageClass = isCurrentUser ? 'own-message' : 'other-message';
            div.classList.add(messageClass);
            div.innerHTML = `
              <img class="chat-message-avatar" src="${escapeHtml(msg.avatar)}" alt="Avatar" />
              <div class="message-content">
                <div class="chat-message-meta">
                  <span class="chat-message-name">${escapeHtml(msg.name)}</span>
                  <span class="chat-message-time">${escapeHtml(msg.created)}</span>
                </div>
                <div class="chat-message-content">${formatMessage(msg.message)}</div>
              </div>
            `;
            msgPanel.appendChild(div);
            if (msg.message_id > lastMessageId) {
              lastMessageId = msg.message_id;
              hasNewMessages = true;
              lastMessageTime = Date.now();
              if (!isCurrentUser) newMessagesFromOthers = true;
            }
          });
          if (hasNewMessages) {
            scrollToBottom(true, true);
            adaptPollingSpeed(true);
            if (newMessagesFromOthers) {
              playNotificationSound();
              if (!isTabActive) {
                document.title = '(Yeni Mesaj) ' + (originalTitle || 'Chat');
              }
            }
          }
        }

        function adaptPollingSpeed(hasNewMessage = false) {
          const now = Date.now();
          const timeSinceLastMessage = now - lastMessageTime;
          let newInterval = currentPollingInterval;
          if (hasNewMessage) {
            newInterval = POLLING_FAST;
            consecutiveEmptyPolls = 0;
          } else {
            consecutiveEmptyPolls++;
            if (consecutiveEmptyPolls > 10) {
              if (timeSinceLastMessage > 30000) {
                newInterval = POLLING_IDLE;
              } else if (timeSinceLastMessage > 10000) {
                newInterval = POLLING_SLOW;
              } else {
                newInterval = POLLING_NORMAL;
              }
            }
          }
          if (!isTabActive) {
            newInterval = 2000;
          }
          if (newInterval !== currentPollingInterval) {
            currentPollingInterval = newInterval;
            restartMessagePolling();
          }
        }

        function formatMessage(text) {
          return escapeHtml(text);
        }

        function fetchMessages(reset = false) {
          if (messageRefreshRunning && !reset) return;
          if (!currentRoomId) return;
          messageRefreshRunning = true;
          const token = drupalSettings.chatSpace && drupalSettings.chatSpace.token ? drupalSettings.chatSpace.token : '';
          let url;
          if (reset || lastMessageId === 0) {
            url = `/chat-space/${currentRoomId}/messages?t=${Date.now()}`;
          } else {
            url = `/chat-space/${currentRoomId}/messages?since=${lastMessageId}&t=${Date.now()}`;
          }
          fetch(url, {
            method: 'GET',
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              'X-CSRF-Token': token,
              'Accept': 'application/json',
              'Cache-Control': 'no-cache'
            },
            cache: 'no-cache'
          })
            .then(r => {
              if (!r.ok) {
                return r.text().then(text => {
                  throw new Error(`HTTP ${r.status}: ${text}`);
                });
              }
              return r.json();
            })
            .then(data => {
              if (data.messages && data.messages.length > 0) {
                if (reset || lastMessageId === 0) {
                  renderMessages(data.messages, true);
                } else {
                  renderMessages(data.messages, false);
                }
              } else {
                adaptPollingSpeed(false);
              }
            })
            .catch(() => {
              adaptPollingSpeed(false);
            })
            .finally(() => {
              messageRefreshRunning = false;
            });
        }

        function sendMessage(e) {
          e.preventDefault();
          if (sendingMessage) return;
          const input = document.getElementById('chat-message-input');
          if (!input) return;
          let msg = input.value.trim();
          if (!msg) return;
          sendingMessage = true;
          const token = drupalSettings.chatSpace && drupalSettings.chatSpace.token ? drupalSettings.chatSpace.token : '';
          const button = document.getElementById('chat-message-send');
          const originalButtonText = button ? button.innerHTML : '';
          if (button) {
            button.disabled = true;
            button.innerHTML = '⏳';
            button.style.opacity = '0.6';
          }
          input.disabled = true;
          input.style.opacity = '0.6';
          stopTyping();
          fetch(`/chat-space/${currentRoomId}/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              'X-CSRF-Token': token
            },
            body: JSON.stringify({message: msg})
          })
          .then(r => {
            if (!r.ok) {
              return r.text().then(text => {
                throw new Error(`HTTP ${r.status}: ${text}`);
              });
            }
            return r.json();
          })
          .then(data => {
            if (data.success && data.message) {
              renderMessages([data.message]);
              input.value = '';
              updateUserActivity();
              if (button) {
                button.innerHTML = '✓';
                button.style.background = '#4CAF50';
                setTimeout(() => {
                  button.innerHTML = originalButtonText;
                  button.style.background = '';
                }, 1000);
              }
            } else if (data.error) {
              showNotification('Mesaj gönderilemedi: ' + data.error, 'error');
              input.value = msg;
            } else {
              showNotification('Beklenmeyen yanıt formatı', 'error');
              input.value = msg;
            }
          })
          .catch(error => {
            showNotification('Mesaj gönderilirken bir hata oluştu: ' + error.message, 'error');
            input.value = msg;
          })
          .finally(() => {
            sendingMessage = false;
            if (button) {
              button.disabled = false;
              if (button.innerHTML === '⏳') button.innerHTML = originalButtonText;
              button.style.opacity = '';
            }
            input.disabled = false;
            input.style.opacity = '';
            input.focus();
          });
        }

        function startTyping() {
          if (isTyping) return;
          isTyping = true;
          const token = drupalSettings.chatSpace && drupalSettings.chatSpace.token ? drupalSettings.chatSpace.token : '';
          fetch(`/chat-space/${currentRoomId}/typing`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              'X-CSRF-Token': token
            },
            body: JSON.stringify({typing: true})
          }).catch(() => {});
        }

        function stopTyping() {
          if (!isTyping) return;
          isTyping = false;
          const token = drupalSettings.chatSpace && drupalSettings.chatSpace.token ? drupalSettings.chatSpace.token : '';
          fetch(`/chat-space/${currentRoomId}/typing`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
              'X-CSRF-Token': token
            },
            body: JSON.stringify({typing: false})
          }).catch(() => {});
        }

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

        function setupUserToggle() {
          const toggleButton = document.getElementById('mobile-user-toggle');
          const userList = document.getElementById('chat-userlist');
          const overlay = document.getElementById('mobile-sidebar-overlay');
          const closeButton = document.getElementById('close-sidebar');
          const mainContainer = document.querySelector('.chat-space-main');
          if (!toggleButton || !userList || !overlay || !mainContainer) return;
          
          let isUserListOpen = false;
          
          function isMobile() { return window.innerWidth <= 768; }
          
          function toggleUserList() {
            isUserListOpen = !isUserListOpen;
            if (isMobile()) {
              if (isUserListOpen) {
                userList.classList.add('mobile-open');
                overlay.classList.add('active');
                toggleButton.classList.add('active');
                toggleButton.querySelector('.toggle-text').textContent = 'Gizle';
                document.body.style.overflow = 'hidden';
              } else {
                closeUserList();
              }
            } else {
              if (isUserListOpen) {
                userList.classList.add('desktop-hidden');
                mainContainer.classList.add('userlist-hidden');
                toggleButton.classList.add('active');
                toggleButton.querySelector('.toggle-text').textContent = 'Gizle';
              } else {
                userList.classList.remove('desktop-hidden');
                mainContainer.classList.remove('userlist-hidden');
                toggleButton.classList.remove('active');
                toggleButton.querySelector('.toggle-text').textContent = 'Kullanıcılar';
              }
            }
          }
          
          function closeUserList() {
            userList.classList.remove('mobile-open');
            userList.classList.remove('desktop-hidden');
            mainContainer.classList.remove('userlist-hidden');
            overlay.classList.remove('active');
            toggleButton.classList.remove('active');
            toggleButton.querySelector('.toggle-text').textContent = 'Kullanıcılar';
            document.body.style.overflow = '';
            isUserListOpen = false;
          }
          
          toggleButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleUserList();
          });
          
          if (closeButton) {
            closeButton.addEventListener('click', function(e) {
              e.preventDefault();
              e.stopPropagation();
              closeUserList();
            });
          }
          
          overlay.addEventListener('click', function() {
            if (isMobile()) closeUserList();
          });
          
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && isUserListOpen) {
              closeUserList();
            }
          });
          
          function handleResize() {
            if (!isMobile()) {
              toggleButton.style.display = 'inline-flex';
              overlay.classList.remove('active');
              document.body.style.overflow = '';
            } else {
              toggleButton.style.display = 'inline-flex';
              userList.classList.remove('desktop-hidden');
              mainContainer.classList.remove('userlist-hidden');
            }
          }
          
          handleResize();
          
          let resizeTimeout;
          window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(handleResize, 150);
          });
          
          let touchStartX = 0;
          let touchEndX = 0;
          
          userList.addEventListener('touchstart', function(e) {
            if (isMobile()) {
              touchStartX = e.changedTouches[0].screenX;
            }
          });
          
          userList.addEventListener('touchend', function(e) {
            if (isMobile()) {
              touchEndX = e.changedTouches[0].screenX;
              if (touchEndX > touchStartX + 50) {
                closeUserList();
              }
            }
          });
        }

        function escapeHtml(text) {
          if (!text) return '';
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }

        function updateUserActivity() {
          lastUserActivity = Date.now();
        }

        function sendHeartbeat() {
          const token = drupalSettings.chatSpace && drupalSettings.chatSpace.token ? drupalSettings.chatSpace.token : '';
          fetch(`/chat-space/${currentRoomId}/heartbeat`, {
            method: 'POST',
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              'X-CSRF-Token': token
            }
          }).catch(() => {});
        }

        let messagePollingInterval = null;
        
        function restartMessagePolling() {
          if (messagePollingInterval) {
            clearInterval(messagePollingInterval);
            messagePollingInterval = null;
          }
          messagePollingInterval = setInterval(function() {
            const containerCheck = document.getElementById('chat-space-container');
            if (!containerCheck || containerCheck.dataset.roomId !== currentRoomId) {
              clearInterval(messagePollingInterval);
              messagePollingInterval = null;
              return;
            }
            if (sendingMessage) return;
            fetchMessages(false);
          }, currentPollingInterval);
          window['chatSpace_msg_' + currentRoomId] = messagePollingInterval;
        }

        function setupAutorefresh() {
          restartMessagePolling();
          
          const userInterval = setInterval(function() {
            const containerCheck = document.getElementById('chat-space-container');
            if (!containerCheck || containerCheck.dataset.roomId !== currentRoomId) {
              clearInterval(userInterval);
              return;
            }
            fetchUsers();
          }, 5000);
          
          heartbeatInterval = setInterval(function() {
            const containerCheck = document.getElementById('chat-space-container');
            if (!containerCheck || containerCheck.dataset.roomId !== currentRoomId) {
              clearInterval(heartbeatInterval);
              return;
            }
            sendHeartbeat();
          }, 10000);
          
          const typingInterval = setInterval(function() {
            const containerCheck = document.getElementById('chat-space-container');
            if (!containerCheck || containerCheck.dataset.roomId !== currentRoomId) {
              clearInterval(typingInterval);
              return;
            }
            cleanupTypingIndicators();
          }, 3000);
          
          window['chatSpace_usr_' + currentRoomId] = userInterval;
          window['chatSpace_hbt_' + currentRoomId] = heartbeatInterval;
          window['chatSpace_typ_' + currentRoomId] = typingInterval;
        }

        function playNotificationSound() {
          if (lastMessageId > 0) {
            try {
              const audioContext = new (window.AudioContext || window.webkitAudioContext)();
              const oscillator = audioContext.createOscillator();
              const gainNode = audioContext.createGain();
              oscillator.connect(gainNode);
              gainNode.connect(audioContext.destination);
              oscillator.frequency.value = 800;
              oscillator.type = 'sine';
              gainNode.gain.setValueAtTime(0, audioContext.currentTime);
              gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01);
              gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
              oscillator.start(audioContext.currentTime);
              oscillator.stop(audioContext.currentTime + 0.5);
            } catch (e) { }
          }
        }

        function cleanupTypingIndicators() {
          const typingElements = document.querySelectorAll('.user-typing');
          typingElements.forEach(el => {
            const parent = el.closest('.userlist-item');
            if (parent) el.remove();
          });
        }

        function showNotification(message, type = 'info') {
          const toast = document.createElement('div');
          toast.className = `chat-notification ${type}`;
          toast.textContent = message;
          toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#ff4444' : '#4444ff'};
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s;
          `;
          document.body.appendChild(toast);
          setTimeout(() => toast.style.opacity = '1', 10);
          setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
              if (document.body.contains(toast)) {
                document.body.removeChild(toast);
              }
            }, 300);
          }, 3000);
        }

        setupEmojiPicker();
        setupUserToggle();

        const input = document.getElementById('chat-message-input');
        if (input) {
          input.addEventListener('keydown', function(e) {
            if (sendingMessage) {
              e.preventDefault();
              return;
            }
            updateUserActivity();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage(e);
              return;
            }
            startTyping();
            if (userTypingTimeout) clearTimeout(userTypingTimeout);
            userTypingTimeout = setTimeout(() => {
              stopTyping();
            }, 3000);
          });
          input.addEventListener('blur', () => { stopTyping(); });
          input.onfocus = () => {
            scrollToBottom(true);
            updateUserActivity();
          };
        }
        
        const form = document.getElementById('chat-message-form');
        if (form) {
          const newForm = form.cloneNode(true);
          form.parentNode.replaceChild(newForm, form);
          newForm.addEventListener('submit', sendMessage);
        }

        document.addEventListener('visibilitychange', function() {
          const wasActive = isTabActive;
          isTabActive = !document.hidden;
          if (isTabActive && !wasActive) {
            document.title = originalTitle;
            fetchMessages(false);
            fetchUsers();
            updateUserActivity();
            currentPollingInterval = POLLING_FAST;
            consecutiveEmptyPolls = 0;
            restartMessagePolling();
          } else if (!isTabActive && wasActive) {
            if (currentPollingInterval < POLLING_NORMAL) {
              currentPollingInterval = POLLING_NORMAL;
              restartMessagePolling();
            }
          }
        });
        
        window.addEventListener('focus', function() {
          if (!isTabActive) {
            isTabActive = true;
            document.title = originalTitle;
            fetchMessages(false);
            fetchUsers();
            updateUserActivity();
            currentPollingInterval = POLLING_FAST;
            consecutiveEmptyPolls = 0;
            restartMessagePolling();
          }
        });
        
        window.addEventListener('blur', function() {
          if (currentPollingInterval < POLLING_NORMAL) {
            currentPollingInterval = POLLING_NORMAL;
            restartMessagePolling();
          }
        });
        
        window.addEventListener('beforeunload', function() {
          stopTyping();
          if (messagePollingInterval) clearInterval(messagePollingInterval);
        });
        
        ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(function(event) {
          document.addEventListener(event, function() {
            updateUserActivity();
            if (currentPollingInterval > POLLING_FAST && consecutiveEmptyPolls < 5) {
              currentPollingInterval = POLLING_FAST;
              restartMessagePolling();
            }
          }, { passive: true });
        });

        setTimeout(function() {
          fetchUsers();
          fetchMessages(true);
          setupAutorefresh();
          scrollToBottom(false);
        }, 100);
      }
    },

    detach: function(context, settings, trigger) {
      if (trigger === 'unload') {
        Object.keys(window).forEach(key => {
          if (key.startsWith('chatSpace_')) {
            clearInterval(window[key]);
            delete window[key];
          }
        });
      }
    }
  };

})(Drupal, drupalSettings);