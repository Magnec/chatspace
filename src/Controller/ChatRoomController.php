<?php

namespace Drupal\chat_space\Controller;

use Drupal\Core\Controller\ControllerBase;
use Drupal\Core\Url;
use Drupal\Core\Link;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Drupal\user\Entity\User;

class ChatRoomController extends ControllerBase {

  /**
   * Lists all chat rooms.
   */
  public function listRooms() {
    $header = [
      $this->t('Başlık'),
      $this->t('Açıklama'),
      $this->t('Katıl'),
      $this->t('İşlemler'),
    ];
    $rows = [];

    $storage = \Drupal::entityTypeManager()->getStorage('chat_space_room');
    $rooms = $storage->loadMultiple();
    $current_uid = $this->currentUser()->id();
    $is_admin = $this->currentUser()->hasPermission('administer chat space');

    foreach ($rooms as $room) {
      $url = Url::fromRoute('chat_space.room', ['room_id' => $room->id()]);
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

  public function viewRoom($room_id) {
    $room = \Drupal::entityTypeManager()->getStorage('chat_space_room')->load($room_id);
    if (!$room) {
      throw new \Symfony\Component\HttpKernel\Exception\NotFoundHttpException();
    }

    // CSRF token'ı JavaScript'e gönder
    $token = \Drupal::csrfToken()->get('chat-space');

    // Debug için log ekle
    \Drupal::logger('chat_space')->info('Room loaded: ID=@id, Title=@title', [
      '@id' => $room->id(),
      '@title' => $room->label()
    ]);

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
            'roomId' => $room_id,
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

  public function getActiveUsers($room_id) {
    // CSRF token kontrolü
    $token = \Drupal::request()->headers->get('X-CSRF-Token');
    if (!\Drupal::csrfToken()->validate($token, 'chat-space')) {
      return new JsonResponse(['error' => 'Invalid token'], 403);
    }

    $current_time = \Drupal::time()->getRequestTime();
    $online_threshold = $current_time - 300; // Son 5 dakika

    // Son mesaj gönderen kullanıcıları al
    $query = \Drupal::database()->select('chat_space_message', 'm')
      ->fields('m', ['uid'])
      ->condition('room_id', $room_id)
      ->condition('created', $online_threshold, '>=')
      ->distinct();

    $message_uids = $query->execute()->fetchCol();
    
    // Heartbeat tablosundan aktif kullanıcıları al (eğer varsa)
    $heartbeat_uids = [];
    if (\Drupal::database()->schema()->tableExists('chat_space_heartbeat')) {
      $heartbeat_query = \Drupal::database()->select('chat_space_heartbeat', 'h')
        ->fields('h', ['uid'])
        ->condition('room_id', $room_id)
        ->condition('last_activity', $online_threshold, '>=');
      $heartbeat_uids = $heartbeat_query->execute()->fetchCol();
    }
    
    // Mevcut kullanıcıyı da ekle
    $current_uid = \Drupal::currentUser()->id();
    $all_uids = array_unique(array_merge($message_uids, $heartbeat_uids, [$current_uid]));
    
    $users = [];
    foreach ($all_uids as $uid) {
      $account = User::load($uid);
      if ($account) {
        $avatar = '/core/themes/stable9/images/avatar.png';
        if ($account->user_picture && $account->user_picture->entity) {
          $avatar = \Drupal::service('file_url_generator')->generateAbsoluteString($account->user_picture->entity->getFileUri());
        }
        
        // Kullanıcının son aktivitesini kontrol et
        $is_online = in_array($uid, $heartbeat_uids) || in_array($uid, $message_uids);
        $last_seen = '';
        
        if (!$is_online && in_array($uid, $message_uids)) {
          // Son mesaj zamanını al
          $last_message_time = \Drupal::database()->select('chat_space_message', 'm')
            ->fields('m', ['created'])
            ->condition('room_id', $room_id)
            ->condition('uid', $uid)
            ->orderBy('created', 'DESC')
            ->range(0, 1)
            ->execute()
            ->fetchField();
          
          if ($last_message_time) {
            $last_seen = format_interval($current_time - $last_message_time) . ' önce';
          }
        }
        
        $users[] = [
          'uid' => $uid,
          'name' => $account->getDisplayName(),
          'avatar' => $avatar,
          'is_online' => $is_online,
          'last_seen' => $last_seen,
        ];
      }
    }
    
    // Online kullanıcıları öne çıkar
    usort($users, function($a, $b) {
      if ($a['is_online'] && !$b['is_online']) return -1;
      if (!$a['is_online'] && $b['is_online']) return 1;
      return strcasecmp($a['name'], $b['name']);
    });

    return new JsonResponse(['users' => $users]);
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