<?php

namespace Drupal\chat_space\Service;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\StringTranslation\StringTranslationTrait;
use Drupal\user\Entity\User;
use Drupal\Core\Url;

/**
 * Kullanıcı etiketleme ve bildirim servisi.
 */
class UserMentionService {
  use StringTranslationTrait;

  protected $entityTypeManager;
  protected $database;

  public function __construct(EntityTypeManagerInterface $entity_type_manager, Connection $database) {
    $this->entityTypeManager = $entity_type_manager;
    $this->database = $database;
  }

  /**
   * Mesaj içerisindeki kullanıcı etiketlerini bul ve işle.
   */
  public function processMentions($message_text, $room_id, $sender_uid, $message_id) {
    $mentions = $this->extractMentions($message_text);
    
    if (empty($mentions)) {
      return [];
    }

    $notified_users = [];
    
    foreach ($mentions as $mention) {
      $mentioned_user = $this->findUserByName($mention);
      
      if ($mentioned_user && $mentioned_user->id() != $sender_uid) {
        // Bildirim oluştur
        $this->createMentionNotification(
          $mentioned_user->id(),
          $sender_uid,
          $room_id,
          $message_id,
          $message_text
        );
        
        $notified_users[] = [
          'uid' => $mentioned_user->id(),
          'name' => $mentioned_user->getDisplayName(),
        ];
      }
    }
    
    return $notified_users;
  }

  /**
   * Mesaj metninden @kullanıcı etiketlerini çıkar.
   */
  public function extractMentions($text) {
    // @kullanıcıadı formatını yakala (alfanumerik, tire, alt çizgi)
    preg_match_all('/@([a-zA-Z0-9\-_]+)/', $text, $matches);
    return array_unique($matches[1]);
  }

  /**
   * Kullanıcı adına göre kullanıcı bul.
   */
  public function findUserByName($username) {
    try {
      $users = $this->entityTypeManager
        ->getStorage('user')
        ->loadByProperties(['name' => $username]);
      
      return !empty($users) ? reset($users) : NULL;
    } catch (\Exception $e) {
      \Drupal::logger('chat_space')->error('Error finding user by name: @error', ['@error' => $e->getMessage()]);
      return NULL;
    }
  }

  /**
   * Etiketleme bildirimi oluştur - TAM OLARAK sizin notification sistemi gibi.
   */
  protected function createMentionNotification($mentioned_uid, $sender_uid, $room_id, $message_id, $message_text) {
    // Message modülü kontrolü
    if (!\Drupal::moduleHandler()->moduleExists('message')) {
      return FALSE;
    }

    try {
      // Oda bilgisini al
      $room = $this->entityTypeManager->getStorage('chat_space_room')->load($room_id);
      $sender = User::load($sender_uid);
      
      if (!$room || !$sender) {
        return FALSE;
      }

      // Template'i kontrol et ve oluştur
      $this->ensureMessageTemplate();

      // Gönderen kullanıcının profil resmini al - TAM OLARAK sizin sisteminizdeki gibi
      $sender_image = '/themes/custom/novebo/images/icon/notify/comment/default-user.png'; // Varsayılan resim
      if (!$sender->get('user_picture')->isEmpty()) {
        $file = $sender->get('user_picture')->entity;
        $sender_image = \Drupal::service('file_url_generator')->generateAbsoluteString($file->getFileUri());
      }

      // Oda URL'sini oluştur
      $room_url = '';
      if ($room->getSlug()) {
        $room_url = \Drupal\Core\Url::fromRoute('chat_space.room_by_slug', [
          'slug' => $room->getSlug()
        ])->setAbsolute()->toString();
      } else {
        $room_url = \Drupal\Core\Url::fromRoute('chat_space.room', [
          'room_id' => $room_id
        ])->setAbsolute()->toString();
      }

      // Mesaj metnini kısalt (ilk 100 karakter)
      $short_message = mb_strlen($message_text) > 100 
        ? mb_substr($message_text, 0, 100) . '...' 
        : $message_text;

      // Bildirim metni oluştur - yeni format
      $notification_text = t('<b>@sender</b> sizi <b>#@room</b> kanalında etiketledi: <a href="@room_url"><em>@message</em></a>', [
        '@sender' => $sender->getDisplayName(),
        '@room' => $room->label(),
        '@room_url' => $room_url,
        '@message' => $short_message,
      ]);

      // Message entity oluştur - TAM OLARAK sizin notification sistemi gibi
      $message_entity = \Drupal\message\Entity\Message::create([
        'template' => 'chat_space_mention',
        'uid' => $mentioned_uid, // Bildirim alacak kişi
        'field_message' => [
          'value' => $notification_text,
          'format' => 'full_html', // HTML formatını kullanın
        ],
        'field_notifications_type' => $sender_image, // Etiketleyen kişinin resmi
      ]);

      $message_entity->save();

      // Log ekle
      \Drupal::logger('chat_space')->info('Mention notification created for user @mentioned by @sender in room @room', [
        '@mentioned' => User::load($mentioned_uid)->getDisplayName(),
        '@sender' => $sender->getDisplayName(),
        '@room' => $room->label(),
      ]);

      return TRUE;
    } catch (\Exception $e) {
      \Drupal::logger('chat_space')->error('Error creating mention notification: @error', ['@error' => $e->getMessage()]);
      return FALSE;
    }
  }

  /**
   * Message template'ini oluştur (eğer yoksa) - Minimal template.
   */
  protected function ensureMessageTemplate() {
    $template_id = 'chat_space_mention';
    
    // Template var mı kontrol et
    $existing = $this->entityTypeManager
      ->getStorage('message_template')
      ->load($template_id);
    
    if ($existing) {
      return;
    }

    try {
      // Template oluştur - minimal
      $template = $this->entityTypeManager
        ->getStorage('message_template')
        ->create([
          'template' => $template_id,
          'label' => 'Chat Space Mention',
          'description' => 'Sohbet odasında kullanıcı etiketleme bildirimi',
          'text' => [], // Boş - field_message kullanılacak
          'settings' => [],
        ]);

      $template->save();

      // Field instance'larını oluştur
      $this->createFieldInstances($template_id);
      
      \Drupal::logger('chat_space')->info('Message template "chat_space_mention" created.');
    } catch (\Exception $e) {
      \Drupal::logger('chat_space')->error('Error creating message template: @error', ['@error' => $e->getMessage()]);
    }
  }

  /**
   * Field instance'larını oluştur.
   */
  protected function createFieldInstances($template_id) {
    try {
      // field_message instance oluştur
      $field_message_storage = $this->entityTypeManager
        ->getStorage('field_storage_config')
        ->load('message.field_message');
      
      if ($field_message_storage) {
        $field_message_instance = $this->entityTypeManager
          ->getStorage('field_config')
          ->load('message.' . $template_id . '.field_message');
        
        if (!$field_message_instance) {
          $field_message_instance = $this->entityTypeManager
            ->getStorage('field_config')
            ->create([
              'field_storage' => $field_message_storage,
              'bundle' => $template_id,
              'label' => 'Message',
              'required' => FALSE,
            ]);
          $field_message_instance->save();
        }
      }

      // field_notifications_type instance oluştur
      $field_notifications_type_storage = $this->entityTypeManager
        ->getStorage('field_storage_config')
        ->load('message.field_notifications_type');
      
      if ($field_notifications_type_storage) {
        $field_notifications_type_instance = $this->entityTypeManager
          ->getStorage('field_config')
          ->load('message.' . $template_id . '.field_notifications_type');
        
        if (!$field_notifications_type_instance) {
          $field_notifications_type_instance = $this->entityTypeManager
            ->getStorage('field_config')
            ->create([
              'field_storage' => $field_notifications_type_storage,
              'bundle' => $template_id,
              'label' => 'Notifications Type',
              'required' => FALSE,
            ]);
          $field_notifications_type_instance->save();
        }
      }

    } catch (\Exception $e) {
      \Drupal::logger('chat_space')->error('Error creating field instances: @error', ['@error' => $e->getMessage()]);
    }
  }

  /**
   * Mesaj metnini HTML format et - etiketleri vurgula.
   */
  public function formatMessageWithMentions($text) {
    // @kullanıcıadı'nı HTML span ile sar
    $formatted = preg_replace_callback(
      '/@([a-zA-Z0-9\-_]+)/',
      function($matches) {
        $username = $matches[1];
        $user = $this->findUserByName($username);
        
        if ($user) {
          return '<span class="user-mention" data-uid="' . $user->id() . '" title="' . $user->getDisplayName() . '">@' . $username . '</span>';
        }
        
        return '@' . $username; // Kullanıcı bulunamazsa olduğu gibi bırak
      },
      htmlspecialchars($text)
    );
    
    return $formatted;
  }

  /**
   * Kullanıcının okunmamış etiket bildirimlerini say.
   */
  public function getUnreadMentionsCount($user_id) {
    if (!\Drupal::moduleHandler()->moduleExists('message')) {
      return 0;
    }

    try {
      $query = $this->entityTypeManager
        ->getStorage('message')
        ->getQuery()
        ->accessCheck(FALSE)
        ->condition('template', 'chat_space_mention')
        ->condition('uid', $user_id)
        ->condition('created', strtotime('-7 days'), '>'); // Son 7 gün

      return $query->count()->execute();
    } catch (\Exception $e) {
      return 0;
    }
  }

  /**
   * Odadaki kullanıcı adlarını autocomplete için al.
   */
  public function getUsernamesForAutocomplete($room_id, $query = '') {
    try {
      // Odadaki aktif kullanıcıları al
      $current_time = \Drupal::time()->getRequestTime();
      $active_threshold = $current_time - 3600; // Son 1 saat

      // Son mesaj gönderen kullanıcıları al
      $message_users = $this->database
        ->select('chat_space_message', 'm')
        ->fields('m', ['uid'])
        ->condition('room_id', $room_id)
        ->condition('created', $active_threshold, '>=')
        ->distinct()
        ->execute()
        ->fetchCol();

      if (empty($message_users)) {
        return [];
      }

      // Kullanıcı bilgilerini al
      $users_query = $this->database
        ->select('users_field_data', 'u')
        ->fields('u', ['uid', 'name'])
        ->condition('uid', $message_users, 'IN')
        ->condition('status', 1)
        ->orderBy('name', 'ASC');

      if (!empty($query)) {
        $users_query->condition('name', '%' . $query . '%', 'LIKE');
      }

      $result = $users_query->execute();
      $usernames = [];

      foreach ($result as $row) {
        $usernames[] = [
          'uid' => $row->uid,
          'name' => $row->name,
        ];
      }

      return $usernames;
    } catch (\Exception $e) {
      \Drupal::logger('chat_space')->error('Error getting usernames for autocomplete: @error', ['@error' => $e->getMessage()]);
      return [];
    }
  }
}