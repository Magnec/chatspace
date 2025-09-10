<?php

namespace Drupal\chat_space\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Url;
use Drupal\Core\Link;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Drupal\user\Entity\User;
use Drupal\chat_space\Entity\ChatRoom;

class ChatRoomController extends ControllerBase {

  /**
   * Lists all chat rooms.
   */
  public function listRooms() {
    $header = [
      $this->t('Başlık'),
      $this->t('Açıklama'),
      $this->t('URL'),
      $this->t('Katıl'),
      $this->t('İşlemler'),
    ];
    $rows = [];

    $storage = \Drupal::entityTypeManager()->getStorage('chat_space_room');
    $rooms = $storage->loadMultiple();
    $current_uid = $this->currentUser()->id();
    $is_admin = $this->currentUser()->hasPermission('administer chat space');

    foreach ($rooms as $room) {
      // Slug varsa slug ile URL oluştur, yoksa ID ile
      $slug = $room->getSlug();
      if ($slug) {
        $url = Url::fromRoute('chat_space.room_by_slug', ['slug' => $slug]);
        $url_text = '/chat-space/room/' . $slug;
      } else {
        $url = Url::fromRoute('chat_space.room', ['room_id' => $room->id()]);
        $url_text = '/chat-space/room/' . $room->id();
      }
      
      $link = Link::fromTextAndUrl($this->t('Odaya Gir'), $url)->toRenderable();

      // Silme ve düzenleme sadece admin veya oda sahibi için
      $operations = [];
      if ($is_admin || $room->get('owner')->target_id == $current_uid) {
        // Sil butonu (delete entity formunu çağır)
        $delete_url = Url::fromRoute('entity.chat_space_room.delete_form', ['chat_space_room' => $room->id()]);
        $delete_link = Link::fromTextAndUrl($this->t('Sil'), $delete_url)->toRenderable();
        // Düzenle butonu
        $edit_url = Url::fromRoute('entity.chat_space_room.edit_form', ['chat_space_room' => $room->id()]);
        $edit_link = Link::fromTextAndUrl($this->t('Düzenle'), $edit_url)->toRenderable();

        $operations[] = $edit_link;
        $operations[] = $delete_link;
      }

      $rows[] = [
        ['data' => $room->label()],
        ['data' => $room->get('description')->value ?: ''],
        ['data' => ['#markup' => '<code>' . $url_text . '</code>']],
        ['data' => $link],
        ['data' => [
          '#theme' => 'item_list',
          '#items' => $operations,
          '#attributes' => ['class' => ['chat-room-operations']],
        ]],
      ];
    }

    // Yeni oda oluştur linki ekle
    $create_url = Url::fromRoute('entity.chat_space_room.add_form');
    $create_link = Link::fromTextAndUrl($this->t('Yeni Oda Oluştur'), $create_url)->toRenderable();

    return [
      'create_link' => [
        '#markup' => '<div class="chat-space-create-link" style="margin-bottom: 20px;">',
        'link' => $create_link,
        '#markup_end' => '</div>',
      ],
      'table' => [
        '#theme' => 'table',
        '#header' => $header,
        '#rows' => $rows,
        '#empty' => $this->t('Henüz hiç sohbet odası yok.'),
        '#cache' => ['max-age' => 0],
      ],
    ];
  }

  public function getRoomTitle($room_id) {
    $room = \Drupal::entityTypeManager()->getStorage('chat_space_room')->load($room_id);
    return $room ? $room->label() : $this->t('Bilinmeyen Oda');
  }

  /**
   * YENİ: Slug ile oda başlığını al.
   */
  public function getRoomTitleBySlug($slug) {
    $room = ChatRoom::loadBySlug($slug);
    return $room ? $room->label() : $this->t('Bilinmeyen Oda');
  }

  public function viewRoom($room_id) {
    $room = \Drupal::entityTypeManager()->getStorage('chat_space_room')->load($room_id);
    if (!$room) {
      throw new \Symfony\Component\HttpKernel\Exception\NotFoundHttpException();
    }

    return $this->renderRoom($room);
  }

  /**
   * YENİ: Slug ile oda görüntüleme.
   */
  public function viewRoomBySlug($slug) {
    $room = ChatRoom::loadBySlug($slug);
    if (!$room) {
      throw new \Symfony\Component\HttpKernel\Exception\NotFoundHttpException();
    }

    // Slug yoksa veya farklıysa doğru URL'ye yönlendir
    $current_slug = $room->getSlug();
    if (!$current_slug || $current_slug !== $slug) {
      // Slug eksikse oluştur
      if (!$current_slug) {
        $room->save(); // Bu slug oluşturacak
        $current_slug = $room->getSlug();
      }
      
      if ($current_slug && $current_slug !== $slug) {
        // Doğru slug'a yönlendir
        $url = Url::fromRoute('chat_space.room_by_slug', ['slug' => $current_slug]);
        return new RedirectResponse($url->toString(), 301);
      }
    }

    return $this->renderRoom($room);
  }

  /**
   * Ortak oda render fonksiyonu.
   */
  protected function renderRoom($room) {
    // CSRF token'ı JavaScript'e gönder
    $token = \Drupal::csrfToken()->get('chat-space');

    // Kullanıcının oda yöneticisi olup olmadığını kontrol et
    $current_user = $this->currentUser();
    $is_room_admin = $current_user->hasPermission('administer chat space') || 
                     $room->get('owner')->target_id == $current_user->id();

    return [
      '#theme' => 'chat_space_room',
      '#room' => $room,
      '#attached' => [
        'library' => [
          'chat_space/chat_space',
        ],
        'drupalSettings' => [
          'chatSpace' => [
            'token' => $token,
            'roomId' => $room->id(),
            'roomSlug' => $room->getSlug(),
            'isRoomAdmin' => $is_room_admin,
          ],
          'user' => [
            'uid' => $this->currentUser()->id(),
            'name' => $this->currentUser()->getDisplayName(),
          ],
        ],
      ],
      '#cache' => ['max-age' => 0],
    ];
  }

  /**
   * Sohbet geçmişini temizle - ID ile.
   */
  public function clearChatHistory($room_id, Request $request) {
    $room = \Drupal::entityTypeManager()->getStorage('chat_space_room')->load($room_id);
    if (!$room) {
      $this->messenger()->addError($this->t('Oda bulunamadı.'));
      return $this->redirect('chat_space.rooms');
    }

    return $this->processClearHistory($room, $request);
  }

  /**
   * YENİ: Sohbet geçmişini temizle - slug ile.
   */
  public function clearChatHistoryBySlug($slug, Request $request) {
    $room = ChatRoom::loadBySlug($slug);
    if (!$room) {
      $this->messenger()->addError($this->t('Oda bulunamadı.'));
      return $this->redirect('chat_space.rooms');
    }

    return $this->processClearHistory($room, $request);
  }

  /**
   * Ortak sohbet geçmişi temizleme işlemi.
   */
  protected function processClearHistory($room, Request $request) {
    $current_user = $this->currentUser();
    
    // Confirm parametresi varsa direkt sil
    if ($request->query->get('confirm') === '1') {
      try {
        // Mesajları sil
        $message_ids = \Drupal::entityTypeManager()
          ->getStorage('chat_space_message')
          ->getQuery()
          ->accessCheck(FALSE)
          ->condition('room_id', $room->id())
          ->execute();

        if ($message_ids) {
          $messages = \Drupal::entityTypeManager()
            ->getStorage('chat_space_message')
            ->loadMultiple($message_ids);
          
          $deleted_count = 0;
          foreach ($messages as $message) {
            $message->delete();
            $deleted_count++;
          }

          $this->messenger()->addMessage($this->t('@count mesaj silindi.', ['@count' => $deleted_count]));
          
          // Sadece önemli işlemleri logla
          \Drupal::logger('chat_space')->notice('Chat history cleared for room @room by user @user (@count messages)', [
            '@room' => $room->label(),
            '@user' => $current_user->getDisplayName(),
            '@count' => $deleted_count,
          ]);
        } else {
          $this->messenger()->addMessage($this->t('Silinecek mesaj bulunamadı.'));
        }

      } catch (\Exception $e) {
        $this->messenger()->addError($this->t('Hata: @error', ['@error' => $e->getMessage()]));
        \Drupal::logger('chat_space')->error('Error clearing chat history: @error', ['@error' => $e->getMessage()]);
      }

      // Doğru URL'ye yönlendir
      if ($room->getSlug()) {
        return $this->redirect('chat_space.room_by_slug', ['slug' => $room->getSlug()]);
      } else {
        return $this->redirect('chat_space.room', ['room_id' => $room->id()]);
      }
    }

    // Onay sayfasını göster
    $slug = $room->getSlug();
    if ($slug) {
      $confirm_url = Url::fromRoute('chat_space.clear_history_by_slug', ['slug' => $slug], ['query' => ['confirm' => '1']])->toString();
      $cancel_url = Url::fromRoute('chat_space.room_by_slug', ['slug' => $slug])->toString();
    } else {
      $confirm_url = Url::fromRoute('chat_space.clear_history', ['room_id' => $room->id()], ['query' => ['confirm' => '1']])->toString();
      $cancel_url = Url::fromRoute('chat_space.room', ['room_id' => $room->id()])->toString();
    }
    
    return [
      '#markup' => '
        <div style="max-width: 600px; margin: 50px auto; padding: 30px; background: #f9f9f9; border-radius: 8px;">
          <h2 style="color: #d73027; margin-bottom: 20px;">Sohbet Geçmişini Temizle</h2>
          <p style="font-size: 16px; margin-bottom: 15px;">Bu işlem "' . $room->label() . '" odasındaki tüm mesajları kalıcı olarak silecektir.</p>
          <p style="color: red; font-weight: bold; font-size: 18px; margin-bottom: 30px;">⚠️ Bu işlem geri alınamaz!</p>
          
          <div style="margin-top: 20px;">
            <a href="' . $confirm_url . '" 
               onclick="return confirm(\'Gerçekten tüm mesajları silmek istiyor musunuz?\')"
               style="background: #d73027; color: white; padding: 12px 25px; border-radius: 4px; margin-right: 15px; font-size: 16px; text-decoration: none; display: inline-block;">
              🗑️ Evet, Tüm Mesajları Sil
            </a>
            
            <a href="' . $cancel_url . '" 
               style="padding: 12px 25px; text-decoration: none; background: #666; color: white; border-radius: 4px; font-size: 16px; display: inline-block;">
              İptal
            </a>
          </div>
        </div>
      ',
    ];
  }

  /**
   * Akıllı kullanıcı listesi - sadece login olmuş ve son aktivite göre.
   */
  public function getActiveUsers($room_id) {
    try {
      // CSRF token kontrolü
      $token = \Drupal::request()->headers->get('X-CSRF-Token');
      $token_valid = \Drupal::csrfToken()->validate($token, 'chat-space');
      
      if (!$token_valid) {
        return new JsonResponse(['error' => 'Invalid token', 'users' => []], 403);
      }

      $current_time = \Drupal::time()->getRequestTime();
      $current_user = \Drupal::currentUser();
      
      // Zaman eşikleri
      $online_threshold = $current_time - 300;    // Son 5 dakika (turuncu için)
      $recent_threshold = $current_time - 86400;  // Son 24 saat (gri için)
      $room_active_threshold = $current_time - 180; // Son 3 dakika (yeşil için)
      
      // 1. Bu odada aktif olan kullanıcıları bul (yeşil)
      $room_active_uids = [];
      
      // Son mesaj gönderen kullanıcılar
      try {
        $message_query = \Drupal::database()->select('chat_space_message', 'm')
          ->fields('m', ['uid'])
          ->condition('room_id', $room_id)
          ->condition('created', $room_active_threshold, '>=')
          ->distinct();
        $recent_message_uids = $message_query->execute()->fetchCol();
        $room_active_uids = array_merge($room_active_uids, $recent_message_uids);
      } catch (\Exception $e) {
        // Sessizce devam et
      }
      
      // Heartbeat tablosundan aktif kullanıcılar
      try {
        if (\Drupal::database()->schema()->tableExists('chat_space_heartbeat')) {
          $heartbeat_query = \Drupal::database()->select('chat_space_heartbeat', 'h')
            ->fields('h', ['uid'])
            ->condition('room_id', $room_id)
            ->condition('last_activity', $room_active_threshold, '>=');
          $heartbeat_uids = $heartbeat_query->execute()->fetchCol();
          $room_active_uids = array_merge($room_active_uids, $heartbeat_uids);
        }
      } catch (\Exception $e) {
        // Sessizce devam et
      }
      
      $room_active_uids = array_unique($room_active_uids);
      
      // 2. Online kullanıcıları bul (turuncu) - session tablosu
      $online_uids = [];
      try {
        if (\Drupal::database()->schema()->tableExists('sessions')) {
          $session_query = \Drupal::database()->select('sessions', 's')
            ->fields('s', ['uid'])
            ->condition('uid', 0, '>')
            ->condition('timestamp', $online_threshold, '>=')
            ->distinct();
          $online_uids = $session_query->execute()->fetchCol();
        }
      } catch (\Exception $e) {
        // Fallback: user access time kullan
        try {
          $user_query = \Drupal::database()->select('users_field_data', 'u')
            ->fields('u', ['uid'])
            ->condition('u.status', 1)
            ->condition('u.uid', 0, '>')
            ->condition('u.access', $online_threshold, '>=');
          $online_uids = $user_query->execute()->fetchCol();
        } catch (\Exception $e2) {
          // Sessizce devam et
        }
      }
      
      // 3. Son 24 saatte aktif olan kullanıcıları al (ana liste)
      $connection = \Drupal::database();
      $query = $connection->select('users_field_data', 'u')
        ->fields('u', ['uid', 'name', 'access', 'login'])
        ->condition('u.status', 1)
        ->condition('u.uid', 0, '>')
        ->condition('u.access', $recent_threshold, '>=') // Son 24 saat içinde aktif
        ->orderBy('u.access', 'DESC'); // En son aktif olanlar üstte
      
      $result = $query->execute();
      $users = [];
      
      foreach ($result as $row) {
        try {
          $uid = (int) $row->uid;
          
          // Avatar URL'sini al
          $avatar_url = 'https://cdn-icons-png.flaticon.com/512/3177/3177440.png';
          
          try {
            $user_picture_query = $connection->select('user__user_picture', 'up')
              ->fields('up', ['user_picture_target_id'])
              ->condition('up.entity_id', $uid)
              ->range(0, 1);
            $picture_result = $user_picture_query->execute()->fetchField();
            
            if ($picture_result) {
              $file_query = $connection->select('file_managed', 'f')
                ->fields('f', ['uri'])
                ->condition('f.fid', $picture_result)
                ->range(0, 1);
              $file_uri = $file_query->execute()->fetchField();
              
              if ($file_uri) {
                $avatar_url = \Drupal::service('file_url_generator')->generateAbsoluteString($file_uri);
              }
            }
          } catch (\Exception $e) {
            // Avatar yüklenemezse default kullan
          }
          
          // Kullanıcı durumunu belirle - YENİ MANTIK
          $is_current = ($uid == $current_user->id());
          $is_in_room = in_array($uid, $room_active_uids);
          $is_online = in_array($uid, $online_uids);
          
          if ($is_in_room || $is_current) {
            // Bu odada aktif - YEŞİL
            $status = 'active';
          } elseif ($is_online) {
            // Sitede online ama bu odada değil - TURUNCU
            $status = 'online';
          } else {
            // Son 24 saatte aktifti ama şu an offline - GRİ
            $status = 'offline';
          }
          
          $users[] = [
            'uid' => $uid,
            'name' => $row->name,
            'avatar' => $avatar_url,
            'status' => $status,
            'is_online' => $status !== 'offline',
            'in_room' => $is_in_room || $is_current,
            'last_access' => (int) $row->access,
            'debug_flags' => [
              'is_current' => $is_current,
              'is_in_room' => $is_in_room,
              'is_online' => $is_online,
            ]
          ];
          
        } catch (\Exception $e) {
          // Kullanıcı işleme hatalarını sessizce atla
          continue;
        }
      }
      
      // Akıllı sıralama: Aktif > Online > Offline, sonra isim
      usort($users, function($a, $b) {
        $order = ['active' => 0, 'online' => 1, 'offline' => 2];
        $a_order = $order[$a['status']] ?? 3;
        $b_order = $order[$b['status']] ?? 3;
        
        if ($a_order !== $b_order) {
          return $a_order - $b_order;
        }
        
        // Aynı durumda ise, son aktiviteye göre sırala
        if ($a_order === $b_order && $a_order === 2) { // Offline kullanıcılar
          return $b['last_access'] - $a['last_access']; // En son aktif olan üstte
        }
        
        return strcasecmp($a['name'], $b['name']);
      });

      return new JsonResponse([
        'users' => $users,
        'stats' => [
          'total' => count($users),
          'active_in_room' => count(array_filter($users, fn($u) => $u['status'] === 'active')),
          'online_elsewhere' => count(array_filter($users, fn($u) => $u['status'] === 'online')),
          'recently_active' => count(array_filter($users, fn($u) => $u['status'] === 'offline')),
        ]
      ]);
      
    } catch (\Exception $e) {
      // Kritik hataları logla
      \Drupal::logger('chat_space')->error('Fatal error in getActiveUsers: @error', [
        '@error' => $e->getMessage(),
      ]);
      
      // Çok basit fallback
      $current_user = \Drupal::currentUser();
      $fallback = [
        [
          'uid' => (int) $current_user->id(),
          'name' => $current_user->getDisplayName() ?: 'You',
          'avatar' => '/core/themes/stable9/images/avatar.png',
          'status' => 'active',
          'is_online' => true,
          'in_room' => true,
        ]
      ];
      
      return new JsonResponse(['users' => $fallback, 'error' => 'Fallback mode']);
    }
  }

  /**
   * Heartbeat endpoint - kullanıcının aktif olduğunu belirt.
   */
  public function heartbeat($room_id) {
    $token = \Drupal::request()->headers->get('X-CSRF-Token');
    if (!\Drupal::csrfToken()->validate($token, 'chat-space')) {
      return new JsonResponse(['error' => 'Invalid token'], 403);
    }

    $current_user = \Drupal::currentUser();
    $current_time = \Drupal::time()->getRequestTime();
    
    // Heartbeat tablosunu oluştur (eğer yoksa)
    $this->ensureHeartbeatTable();
    
    try {
      // Kullanıcının heartbeat'ini güncelle
      \Drupal::database()->merge('chat_space_heartbeat')
        ->key([
          'uid' => $current_user->id(),
          'room_id' => $room_id,
        ])
        ->fields([
          'last_activity' => $current_time,
        ])
        ->execute();
      
      // Eski heartbeat'leri temizle (1 saat öncesinden)
      \Drupal::database()->delete('chat_space_heartbeat')
        ->condition('last_activity', $current_time - 3600, '<')
        ->execute();
    } catch (\Exception $e) {
      // Heartbeat hatalarını sessizce atla
    }

    return new JsonResponse(['success' => true]);
  }

  /**
   * Typing indicator endpoint.
   */
  public function typing($room_id, Request $request) {
    $token = $request->headers->get('X-CSRF-Token');
    if (!\Drupal::csrfToken()->validate($token, 'chat-space')) {
      return new JsonResponse(['error' => 'Invalid token'], 403);
    }

    $data = json_decode($request->getContent(), TRUE);
    $is_typing = $data['typing'] ?? false;
    $current_user = \Drupal::currentUser();
    $current_time = \Drupal::time()->getRequestTime();
    
    // Typing tablosunu oluştur (eğer yoksa)
    $this->ensureTypingTable();
    
    try {
      if ($is_typing) {
        // Typing indicator ekle/güncelle
        \Drupal::database()->merge('chat_space_typing')
          ->key([
            'uid' => $current_user->id(),
            'room_id' => $room_id,
          ])
          ->fields([
            'started_typing' => $current_time,
          ])
          ->execute();
      } else {
        // Typing indicator'ı kaldır
        \Drupal::database()->delete('chat_space_typing')
          ->condition('uid', $current_user->id())
          ->condition('room_id', $room_id)
          ->execute();
      }
      
      // Eski typing indicator'ları temizle (10 saniye)
      \Drupal::database()->delete('chat_space_typing')
        ->condition('started_typing', $current_time - 10, '<')
        ->execute();
    } catch (\Exception $e) {
      // Typing hatalarını sessizce atla
    }

    return new JsonResponse(['success' => true]);
  }

  /**
   * Heartbeat tablosunu oluştur.
   */
  private function ensureHeartbeatTable() {
    $schema = \Drupal::database()->schema();
    if (!$schema->tableExists('chat_space_heartbeat')) {
      $table_spec = [
        'description' => 'Kullanıcı heartbeat bilgileri',
        'fields' => [
          'uid' => [
            'type' => 'int',
            'not null' => TRUE,
            'unsigned' => TRUE,
          ],
          'room_id' => [
            'type' => 'int',
            'not null' => TRUE,
            'unsigned' => TRUE,
          ],
          'last_activity' => [
            'type' => 'int',
            'not null' => TRUE,
            'unsigned' => TRUE,
          ],
        ],
        'primary key' => ['uid', 'room_id'],
        'indexes' => [
          'last_activity' => ['last_activity'],
          'room_id' => ['room_id'],
        ],
      ];
      $schema->createTable('chat_space_heartbeat', $table_spec);
    }
  }

  /**
   * Typing tablosunu oluştur.
   */
  private function ensureTypingTable() {
    $schema = \Drupal::database()->schema();
    if (!$schema->tableExists('chat_space_typing')) {
      $table_spec = [
        'description' => 'Kullanıcı typing indicator bilgileri',
        'fields' => [
          'uid' => [
            'type' => 'int',
            'not null' => TRUE,
            'unsigned' => TRUE,
          ],
          'room_id' => [
            'type' => 'int',
            'not null' => TRUE,
            'unsigned' => TRUE,
          ],
          'started_typing' => [
            'type' => 'int',
            'not null' => TRUE,
            'unsigned' => TRUE,
          ],
        ],
        'primary key' => ['uid', 'room_id'],
        'indexes' => [
          'started_typing' => ['started_typing'],
          'room_id' => ['room_id'],
        ],
      ];
      $schema->createTable('chat_space_typing', $table_spec);
    }
  }
}