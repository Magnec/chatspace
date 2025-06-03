(function (Drupal, drupalSettings) {
  'use strict';

  Drupal.behaviors.chatSpace = {
    attach: function(context, settings) {
      const container = document.getElementById('chat-space-container');
      if (!container || container.hasAttribute('data-chat-processed')) {
        return;
      }

      // YENİ: Clear history sayfası için özel işlem
      if (drupalSettings.chatSpace && drupalSettings.chatSpace.clearHistory) {
        const confirmCheckbox = document.getElementById('confirm-delete');
        const deleteButton = document.getElementById('delete-btn');
        
        if (confirmCheckbox && deleteButton) {
          confirmCheckbox.addEventListener('change', function() {
            deleteButton.disabled = !this.checked;
            if (this.checked) {
              deleteButton.style.opacity = '1';
              deleteButton.style.cursor = 'pointer';
            } else {
              deleteButton.style.opacity = '0.5';
              deleteButton.style.cursor = 'not-allowed';
            }
          });
        }
        return; // Clear history sayfasında chat işlevlerini başlatma
      }

      initializeChat(container);

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
        let settingsDropdownOpen = false;
        let csrfToken = '';
        let mobileUserListOpen = false;

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
          if (!msgPanel) return;
          
          setTimeout(function() {
            if (animated) {
              msgPanel.scrollTo({
                top: msgPanel.scrollHeight,
                behavior: 'smooth'
              });
            } else {
              msgPanel.scrollTop = msgPanel.scrollHeight;
            }
            console.log('Scroll yapıldı:', msgPanel.scrollTop, '/', msgPanel.scrollHeight);
          }, 100);
        }

        function refreshToken() {
          return fetch('/chat-space/get-token', {
            method: 'GET',
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
            },
          })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.token) {
              csrfToken = data.token;
              return csrfToken;
            }
            throw new Error('No token in response');
          })
          .catch(function(error) {
            console.error('Token refresh failed:', error);
            csrfToken = drupalSettings.chatSpace && drupalSettings.chatSpace.token ? drupalSettings.chatSpace.token : '';
            return csrfToken;
          });
        }

        function makeRequestWithToken(url, options) {
          options = options || {};
          const token = csrfToken || (drupalSettings.chatSpace && drupalSettings.chatSpace.token ? drupalSettings.chatSpace.token : '');
          
          const defaultHeaders = {
            'X-Requested-With': 'XMLHttpRequest',
            'Cache-Control': 'no-cache',
          };
          
          if (token) {
            defaultHeaders['X-CSRF-Token'] = token;
          }
          
          const finalOptions = {
            method: options.method || 'GET',
            headers: Object.assign(defaultHeaders, options.headers || {}),
            body: options.body || null
          };
          
          return fetch(url, finalOptions);
        }

        function renderUserList(users) {
          const userlist = document.querySelector('.userlist-list');
          if (!userlist) {
            return;
          }
          
          userlist.innerHTML = '';
          
          if (!users || users.length === 0) {
            userlist.innerHTML = '<li><span>Kimse yok</span></li>';
            return;
          }
          
          users.forEach(function(user) {
            const li = document.createElement('li');
            const isCurrentUser = user.uid == drupalSettings.user?.uid;
            
            const statusClass = user.status || 'offline';
            const currentUserClass = isCurrentUser ? 'current-user' : '';
            
            li.className = 'userlist-item user-' + statusClass + ' ' + currentUserClass;
            
            let avatarUrl = user.avatar || '/core/themes/stable9/images/avatar.png';
            
            if (avatarUrl.startsWith('/') && !avatarUrl.startsWith('//')) {
              const baseUrl = window.location.origin;
              avatarUrl = baseUrl + avatarUrl;
            }
            
            li.innerHTML = '<div class="user-avatar-container">' +
              '<img src="' + escapeHtml(avatarUrl) + '" loading="lazy" alt="Avatar" onerror="this.src=\'/core/themes/stable9/images/avatar.png\';" />' +
              '<span class="user-status-dot ' + statusClass + '" title="' + statusClass + '"></span>' +
              '</div>' +
              '<div class="user-info">' +
              '<span class="userlist-name">' + escapeHtml(user.name) + '</span>' +
              '</div>';
            
            userlist.appendChild(li);
          });
          
          const allDots = userlist.querySelectorAll('.user-status-dot');
          allDots.forEach(function(dot) {
            dot.textContent = '';
            dot.innerHTML = '';
          });
        }

        function fetchUsers() {
          if (userRefreshRunning) return;
          userRefreshRunning = true;
          
          makeRequestWithToken('/chat-space/' + currentRoomId + '/users?t=' + Date.now())
            .then(function(r) {
              if (!r.ok) {
                if (r.status === 403) {
                  return refreshToken().then(function() {
                    return makeRequestWithToken('/chat-space/' + currentRoomId + '/users?t=' + Date.now());
                  });
                }
                return r.text().then(function(text) {
                  throw new Error('HTTP ' + r.status + ': ' + text);
                });
              }
              return r.json();
            })
            .then(function(data) {
              if (data && data.users && Array.isArray(data.users) && data.users.length > 0) {
                renderUserList(data.users);
                updateUserCount(data.users.length, data.stats);
              } else {
                createFallbackUserList();
              }
            })
            .catch(function(error) {
              console.error('User fetch failed:', error);
              createFallbackUserList();
            })
            .finally(function() {
              userRefreshRunning = false;
            });
        }

        function createFallbackUserList() {
          const fallbackUsers = [
            {
              uid: drupalSettings.user?.uid || 1,
              name: drupalSettings.user?.name || 'You',
              avatar: '/core/themes/stable9/images/avatar.png',
              status: 'active',
              is_online: true,
              in_room: true,
            }
          ];
          
          renderUserList(fallbackUsers);
          updateUserCount(fallbackUsers.length);
        }

        function updateUserCount(count, stats) {
          const header = document.querySelector('.userlist-header .user-count');
          if (header) {
            if (stats) {
              const activeCount = stats.active_in_room + stats.online_elsewhere;
              const tooltip = 'Toplam: ' + stats.total + '\\n🟢 Odada: ' + stats.active_in_room + '\\n🟡 Online: ' + stats.online_elsewhere + '\\n⚪ Son 24h: ' + stats.recently_active;
              header.textContent = '(' + activeCount + ')';
              header.title = tooltip;
            } else {
              header.textContent = '(' + count + ')';
            }
          }
          
          const toggleButton = document.getElementById('mobile-user-toggle');
          if (toggleButton) {
            const toggleText = toggleButton.querySelector('.toggle-text');
            if (toggleText) {
              const baseText = mobileUserListOpen ? 'Gizle' : 'Kullanıcılar';
              if (stats) {
                const activeCount = stats.active_in_room + stats.online_elsewhere;
                toggleText.textContent = baseText + ' (' + activeCount + ')';
              } else {
                toggleText.textContent = baseText + ' (' + count + ')';
              }
            }
          }
        }

        function renderMessages(messages, reset) {
          reset = reset || false;
          const msgPanel = document.getElementById('chat-messages');
          if (!msgPanel) return;
          
          if (reset) {
            msgPanel.innerHTML = '';
            lastMessageId = 0;
          }
          
          let hasNewMessages = false;
          let newMessagesFromOthers = false;
          
          messages.forEach(function(msg) {
            if (document.querySelector('[data-message-id="' + msg.message_id + '"]')) {
              return;
            }
            
            const div = document.createElement('div');
            div.className = 'chat-message-bubble';
            div.dataset.messageId = msg.message_id;
            const isCurrentUser = msg.uid == drupalSettings.user?.uid;
            const messageClass = isCurrentUser ? 'own-message' : 'other-message';
            div.classList.add(messageClass);
            
            // YENİ: Edit/Delete butonları
            let actionsHtml = '';
            if (msg.can_edit || msg.can_delete) {
              actionsHtml = '<div class="message-actions">';
              if (msg.can_edit) {
                actionsHtml += '<button class="message-action-btn edit-btn" title="Düzenle" onclick="editMessage(' + msg.message_id + ')">✏️</button>';
              }
              if (msg.can_delete) {
                actionsHtml += '<button class="message-action-btn delete-btn" title="Sil" onclick="deleteMessage(' + msg.message_id + ')">🗑️</button>';
              }
              actionsHtml += '</div>';
            }
            
            // YENİ: Düzenleme göstergesi
            let editedText = '';
            if (msg.is_edited) {
              editedText = '<span class="chat-message-edited">(düzenlendi)</span>';
            }
            
            div.innerHTML = '<img class="chat-message-avatar" src="' + escapeHtml(msg.avatar) + '" alt="Avatar" />' +
              '<div class="message-content">' +
              '<div class="chat-message-meta">' +
              '<span class="chat-message-name">' + escapeHtml(msg.name) + '</span>' +
              '<span class="chat-message-time">' + escapeHtml(msg.created) + '</span>' +
              editedText +
              '</div>' +
              '<div class="chat-message-content" data-original-text="' + escapeHtml(msg.message) + '">' + formatMessage(msg.message) + '</div>' +
              actionsHtml +
              // YENİ: Inline edit form
              '<div class="message-edit-form" id="edit-form-' + msg.message_id + '">' +
              '<textarea class="message-edit-input" id="edit-input-' + msg.message_id + '">' + escapeHtml(msg.message) + '</textarea>' +
              '<div class="message-edit-actions">' +
              '<button class="message-edit-save" onclick="saveEdit(' + msg.message_id + ')">Kaydet</button>' +
              '<button class="message-edit-cancel" onclick="cancelEdit(' + msg.message_id + ')">İptal</button>' +
              '</div>' +
              '</div>' +
              '</div>';
            
            msgPanel.appendChild(div);
            hasNewMessages = true; // Her yeni DOM elementi için scroll yap
            
            if (msg.message_id > lastMessageId) {
              lastMessageId = msg.message_id;
              lastMessageTime = Date.now();
              if (!isCurrentUser) newMessagesFromOthers = true;
            }
          });
          
          // Yeni mesaj varsa scroll yap
          if (hasNewMessages) {
            console.log('Yeni mesaj var, scroll yapılıyor');
            scrollToBottom(true);
            adaptPollingSpeed(true);
            
            if (newMessagesFromOthers) {
              playNotificationSound();
              if (!isTabActive) {
                document.title = '(Yeni Mesaj) ' + (originalTitle || 'Chat');
              }
            }
          }
        }

        // YENİ: Mesaj düzenleme fonksiyonu
        window.editMessage = function(messageId) {
          const editForm = document.getElementById('edit-form-' + messageId);
          const messageContent = document.querySelector('[data-message-id="' + messageId + '"] .chat-message-content');
          const actions = document.querySelector('[data-message-id="' + messageId + '"] .message-actions');
          
          if (editForm && messageContent) {
            editForm.classList.add('active');
            messageContent.style.display = 'none';
            if (actions) actions.style.display = 'none';
            
            const input = document.getElementById('edit-input-' + messageId);
            if (input) {
              input.focus();
              input.setSelectionRange(input.value.length, input.value.length);
            }
          }
        };

        // YENİ: Düzenleme kaydetme
        window.saveEdit = function(messageId) {
          const input = document.getElementById('edit-input-' + messageId);
          const newMessage = input.value.trim();
          
          if (!newMessage) {
            showNotification('Boş mesaj gönderilemez.', 'error');
            return;
          }
          
          const saveBtn = document.querySelector('#edit-form-' + messageId + ' .message-edit-save');
          saveBtn.disabled = true;
          saveBtn.textContent = 'Kaydediliyor...';
          
          makeRequestWithToken('/chat-space/' + currentRoomId + '/message/' + messageId + '/edit', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({message: newMessage})
          })
          .then(function(r) {
            if (!r.ok) {
              return r.text().then(function(text) {
                throw new Error('HTTP ' + r.status + ': ' + text);
              });
            }
            return r.json();
          })
          .then(function(data) {
            if (data.success) {
              // Mesajı güncelle
              const messageContent = document.querySelector('[data-message-id="' + messageId + '"] .chat-message-content');
              const meta = document.querySelector('[data-message-id="' + messageId + '"] .chat-message-meta');
              
              if (messageContent) {
                messageContent.setAttribute('data-original-text', newMessage);
                messageContent.innerHTML = formatMessage(newMessage);
                messageContent.style.display = 'block';
              }
              
              // Düzenleme göstergesini ekle
              if (meta && !meta.querySelector('.chat-message-edited')) {
                meta.innerHTML += '<span class="chat-message-edited">(düzenlendi)</span>';
              }
              
              cancelEdit(messageId);
              showNotification('Mesaj güncellendi.', 'success');
            } else {
              throw new Error(data.error || 'Bilinmeyen hata');
            }
          })
          .catch(function(error) {
            console.error('Edit failed:', error);
            showNotification('Mesaj düzenlenemedi: ' + error.message, 'error');
          })
          .finally(function() {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Kaydet';
          });
        };

        // YENİ: Düzenleme iptali
        window.cancelEdit = function(messageId) {
          const editForm = document.getElementById('edit-form-' + messageId);
          const messageContent = document.querySelector('[data-message-id="' + messageId + '"] .chat-message-content');
          const actions = document.querySelector('[data-message-id="' + messageId + '"] .message-actions');
          const input = document.getElementById('edit-input-' + messageId);
          
          if (editForm && messageContent) {
            editForm.classList.remove('active');
            messageContent.style.display = 'block';
            if (actions) actions.style.display = 'flex';
            
            // Orijinal metni geri yükle
            if (input && messageContent.dataset.originalText) {
              input.value = messageContent.dataset.originalText;
            }
          }
        };

        // YENİ: Mesaj silme fonksiyonu
        window.deleteMessage = function(messageId) {
          if (!confirm('Bu mesajı silmek istediğinizden emin misiniz?')) {
            return;
          }
          
          const deleteBtn = document.querySelector('[data-message-id="' + messageId + '"] .delete-btn');
          if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = '⏳';
          }
          
          makeRequestWithToken('/chat-space/' + currentRoomId + '/message/' + messageId + '/delete', {
            method: 'POST'
          })
          .then(function(r) {
            if (!r.ok) {
              return r.text().then(function(text) {
                throw new Error('HTTP ' + r.status + ': ' + text);
              });
            }
            return r.json();
          })
          .then(function(data) {
            if (data.success) {
              // Mesajı kaldır veya "silindi" olarak işaretle
              const messageBubble = document.querySelector('[data-message-id="' + messageId + '"]');
              if (messageBubble) {
                messageBubble.style.opacity = '0.5';
                messageBubble.classList.add('deleted');
                
                const messageContent = messageBubble.querySelector('.chat-message-content');
                if (messageContent) {
                  messageContent.innerHTML = '<em>Bu mesaj silindi.</em>';
                }
                
                const actions = messageBubble.querySelector('.message-actions');
                if (actions) {
                  actions.remove();
                }
              }
              showNotification('Mesaj silindi.', 'success');
            } else {
              throw new Error(data.error || 'Bilinmeyen hata');
            }
          })
          .catch(function(error) {
            console.error('Delete failed:', error);
            showNotification('Mesaj silinemedi: ' + error.message, 'error');
            if (deleteBtn) {
              deleteBtn.disabled = false;
              deleteBtn.innerHTML = '🗑️';
            }
          });
        };

        function adaptPollingSpeed(hasNewMessage) {
          hasNewMessage = hasNewMessage || false;
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

        function fetchMessages(reset) {
          reset = reset || false;
          if (messageRefreshRunning && !reset) return;
          if (!currentRoomId) return;
          messageRefreshRunning = true;
          
          let url;
          if (reset || lastMessageId === 0) {
            url = '/chat-space/' + currentRoomId + '/messages?t=' + Date.now();
          } else {
            url = '/chat-space/' + currentRoomId + '/messages?since=' + lastMessageId + '&t=' + Date.now();
          }
          
          makeRequestWithToken(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            }
          })
            .then(function(r) {
              if (!r.ok) {
                return r.text().then(function(text) {
                  throw new Error('HTTP ' + r.status + ': ' + text);
                });
              }
              return r.json();
            })
            .then(function(data) {
              if (data.messages && data.messages.length > 0) {
                console.log('Yeni mesaj geldi:', data.messages.length, 'adet');
                if (reset || lastMessageId === 0) {
                  renderMessages(data.messages, true);
                } else {
                  renderMessages(data.messages, false);
                }
              } else {
                adaptPollingSpeed(false);
              }
            })
            .catch(function(error) {
              console.error('Message fetch failed:', error);
              adaptPollingSpeed(false);
            })
            .finally(function() {
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
          
          makeRequestWithToken('/chat-space/' + currentRoomId + '/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({message: msg})
          })
          .then(function(r) {
            if (!r.ok) {
              return r.text().then(function(text) {
                throw new Error('HTTP ' + r.status + ': ' + text);
              });
            }
            return r.json();
          })
          .then(function(data) {
            if (data.success && data.message) {
              renderMessages([data.message]);
              input.value = '';
              updateUserActivity();
              
              setTimeout(function() {
                fetchUsers();
              }, 500);
              
              if (button) {
                button.innerHTML = '✓';
                button.style.background = '#4CAF50';
                setTimeout(function() {
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
          .catch(function(error) {
            console.error('Send message error:', error);
            showNotification('Mesaj gönderilirken bir hata oluştu: ' + error.message, 'error');
            input.value = msg;
          })
          .finally(function() {
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
          makeRequestWithToken('/chat-space/' + currentRoomId + '/typing', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({typing: true})
          }).catch(function(error) {
            // Typing hatalarını loglama
          });
        }

        function stopTyping() {
          if (!isTyping) return;
          isTyping = false;
          makeRequestWithToken('/chat-space/' + currentRoomId + '/typing', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({typing: false})
          }).catch(function(error) {
            // Typing hatalarını loglama
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
          makeRequestWithToken('/chat-space/' + currentRoomId + '/heartbeat', {
            method: 'POST'
          }).catch(function(error) {
            // Heartbeat hatalarını loglama
          });
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
          }, 2000);
          
          heartbeatInterval = setInterval(function() {
            const containerCheck = document.getElementById('chat-space-container');
            if (!containerCheck || containerCheck.dataset.roomId !== currentRoomId) {
              clearInterval(heartbeatInterval);
              return;
            }
            sendHeartbeat();
          }, 5000);
          
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
          typingElements.forEach(function(el) {
            const parent = el.closest('.userlist-item');
            if (parent) el.remove();
          });
        }

        function showNotification(message, type) {
          type = type || 'info';
          const toast = document.createElement('div');
          toast.className = 'chat-notification ' + type;
          toast.textContent = message;
          toast.style.cssText = 'position: fixed; top: 20px; right: 20px; background: ' + 
            (type === 'error' ? '#ff4444' : type === 'success' ? '#4CAF50' : '#4444ff') + 
            '; color: white; padding: 10px 20px; border-radius: 5px; z-index: 10000; opacity: 0; transition: opacity 0.3s;';
          document.body.appendChild(toast);
          setTimeout(function() { toast.style.opacity = '1'; }, 10);
          setTimeout(function() {
            toast.style.opacity = '0';
            setTimeout(function() {
              if (document.body.contains(toast)) {
                document.body.removeChild(toast);
              }
            }, 300);
          }, 3000);
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

        // USER TOGGLE
        function setupUserToggle() {
          const toggleButton = document.getElementById('mobile-user-toggle');
          const userList = document.getElementById('chat-userlist');
          const overlay = document.getElementById('mobile-sidebar-overlay');
          const closeButton = document.getElementById('close-sidebar');
          const mainContainer = document.querySelector('.chat-space-main');

          if (!toggleButton || !userList) return;

          toggleButton.addEventListener('click', function(e) {
            e.preventDefault();
            
            mobileUserListOpen = !mobileUserListOpen;
            
            if (window.innerWidth <= 768) {
              // Mobile
              if (mobileUserListOpen) {
                userList.classList.add('mobile-open');
                if (overlay) overlay.classList.add('active');
                toggleButton.classList.add('active');
              } else {
                userList.classList.remove('mobile-open');
                if (overlay) overlay.classList.remove('active');
                toggleButton.classList.remove('active');
              }
            } else {
              // Desktop
              if (mobileUserListOpen) {
                userList.classList.add('desktop-hidden');
                if (mainContainer) mainContainer.classList.add('userlist-hidden');
                toggleButton.classList.add('active');
              } else {
                userList.classList.remove('desktop-hidden');
                if (mainContainer) mainContainer.classList.remove('userlist-hidden');
                toggleButton.classList.remove('active');
              }
            }
            
            const toggleText = toggleButton.querySelector('.toggle-text');
            if (toggleText) {
              toggleText.textContent = mobileUserListOpen ? 'Gizle' : 'Kullanıcılar';
            }
          });

          if (closeButton) {
            closeButton.addEventListener('click', function(e) {
              e.preventDefault();
              mobileUserListOpen = false;
              userList.classList.remove('mobile-open');
              if (overlay) overlay.classList.remove('active');
              toggleButton.classList.remove('active');
              
              const toggleText = toggleButton.querySelector('.toggle-text');
              if (toggleText) {
                toggleText.textContent = 'Kullanıcılar';
              }
            });
          }

          if (overlay) {
            overlay.addEventListener('click', function(e) {
              if (mobileUserListOpen) {
                mobileUserListOpen = false;
                userList.classList.remove('mobile-open');
                overlay.classList.remove('active');
                toggleButton.classList.remove('active');
                
                const toggleText = toggleButton.querySelector('.toggle-text');
                if (toggleText) {
                  toggleText.textContent = 'Kullanıcılar';
                }
              }
            });
          }
        }

        // ROOM SETTINGS
        function setupRoomSettings() {
          const settingsButton = document.getElementById('room-settings-btn');
          if (!settingsButton) return;

          const dropdown = document.createElement('div');
          dropdown.className = 'room-settings-dropdown';
          dropdown.innerHTML = 
            '<a href="/chat-space/' + currentRoomId + '/clear-history" class="danger">🗑️ Sohbet Geçmişini Temizle</a>' +
            '<a href="/chat-space/' + currentRoomId + '/edit">✏️ Odayı Düzenle</a>';
          
          settingsButton.appendChild(dropdown);

          settingsButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            if (e.target.tagName === 'A') {
              return;
            }
            
            settingsDropdownOpen = !settingsDropdownOpen;
            
            if (settingsDropdownOpen) {
              dropdown.classList.add('active');
            } else {
              dropdown.classList.remove('active');
            }
          });

          dropdown.addEventListener('click', function(e) {
            if (e.target.tagName === 'A') {
              e.stopPropagation();
              dropdown.classList.remove('active');
              settingsDropdownOpen = false;
              return true;
            }
          });

          document.addEventListener('click', function(e) {
            if (settingsDropdownOpen && !settingsButton.contains(e.target)) {
              dropdown.classList.remove('active');
              settingsDropdownOpen = false;
            }
          });
        }

        // INPUT EVENTS
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
            userTypingTimeout = setTimeout(function() {
              stopTyping();
            }, 3000);
          });
          
          input.addEventListener('blur', function() { 
            stopTyping(); 
          });
          
          input.addEventListener('focus', function() {
            scrollToBottom(true);
            updateUserActivity();
          });
        }
        
        const form = document.getElementById('chat-message-form');
        if (form) {
          const newForm = form.cloneNode(true);
          form.parentNode.replaceChild(newForm, form);
          newForm.addEventListener('submit', sendMessage);
        }

        // TAB VISIBILITY
        document.addEventListener('visibilitychange', function() {
          if (document.hidden) {
            isTabActive = false;
          } else {
            isTabActive = true;
            document.title = originalTitle;
            adaptPollingSpeed(false);
          }
        });

        // SETUP EVENT HANDLERS
        setupEmojiPicker();
        setupUserToggle();
        setupRoomSettings();

        // INITIALIZE - İLK SCROLL DA EKLENDI
        setTimeout(function() {
          refreshToken()
            .then(function(token) {
              fetchUsers();
              fetchMessages(true);
              setupAutorefresh();
              // İlk yükleme sonrası scroll
              setTimeout(function() {
                scrollToBottom(false);
              }, 500);
            })
            .catch(function(error) {
              console.warn('Token refresh failed, using fallback:', error);
              csrfToken = drupalSettings.chatSpace?.token || '';
              fetchUsers();
              fetchMessages(true);
              setupAutorefresh();
              // Fallback durumunda da scroll
              setTimeout(function() {
                scrollToBottom(false);
              }, 500);
            });
        }, 100);
      }
    },

    detach: function(context, settings, trigger) {
      if (trigger === 'unload') {
        Object.keys(window).forEach(function(key) {
          if (key.startsWith('chatSpace_')) {
            clearInterval(window[key]);
            delete window[key];
          }
        });
      }
    }
  };

})(Drupal, drupalSettings);