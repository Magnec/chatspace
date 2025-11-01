<?php

namespace Drupal\chat_space\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\JsonResponse;
use Drupal\chat_space\Entity\ChatMessage;
use Drupal\user\Entity\User;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Class ChatMessageController.
 */
class ChatMessageController extends ControllerBase {

  /**
   * AJAX endpoint to send a message.
   */
  public function sendMessage($room_id, Request $request) {
    $current_user = $this->currentUser();

    // CSRF token kontrolü
    $token = $request->headers->get('X-CSRF-Token');
    if (!\Drupal::csrfToken()->validate($token, 'chat-space')) {
      return new JsonResponse(['error' => 'Invalid token'], 403);
    }

    // YENİ: Rate limiting - dakikada 20 mesaj
    $flood = \Drupal::flood();
    if (!$flood->isAllowed('chat_space.send_message', 20, 60)) {
      return new JsonResponse(['error' => 'Çok fazla mesaj gönderdiniz. Lütfen bekleyin.'], 429);
    }

    // Content-Type kontrolü
    if ($request->headers->get('Content-Type') !== 'application/json') {
      return new JsonResponse(['error' => 'Invalid content type'], 400);
    }

    $data = json_decode($request->getContent(), TRUE);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
      return new JsonResponse(['error' => 'Invalid JSON'], 400);
    }

    // Basit validasyon
    $msg = trim($data['message'] ?? '');
    if (!$msg) {
      return new JsonResponse(['error' => 'Boş mesaj gönderilemez.'], 400);
    }

    if (strlen($msg) > 512) {
      return new JsonResponse(['error' => 'Mesaj çok uzun.'], 400);
    }

    // Room'un var olup olmadığını kontrol et
    $room = \Drupal::entityTypeManager()->getStorage('chat_space_room')->load($room_id);
    if (!$room) {
      return new JsonResponse(['error' => 'Oda bulunamadı.'], 404);
    }

    try {
      // YENİ: Flood kaydı
      $flood->register('chat_space.send_message');

      // Mesajı kaydet
      $message = ChatMessage::create([
        'room_id' => $room_id,
        'uid' => $current_user->id(),
        'message' => $msg,
        'created' => \Drupal::time()->getRequestTime(),
        'status' => 1, // Aktif
      ]);
      
      $violation = $message->validate();
      if ($violation->count() > 0) {
        $error_msg = [];
        foreach ($violation as $v) {
          $error_msg[] = $v->getMessage();
        }
        // Sadece kritik hataları logla
        \Drupal::logger('chat_space')->error('Message validation failed: @errors', ['@errors' => implode(', ', $error_msg)]);
        return new JsonResponse(['error' => 'Mesaj doğrulanamadı: ' . implode(', ', $error_msg)], 400);
      }
      
      $message->save();

      // YENİ: Mention işleme
      $mention_service = \Drupal::service('chat_space.mention_service');
      $mentioned_users = [];
      
      try {
        $mentioned_users = $mention_service->processMentions(
          $msg,
          $room_id,
          $current_user->id(),
          $message->id()
        );
      } catch (\Exception $e) {
        // Mention hatalarını sessizce logla, mesaj gönderimini durdurma
        \Drupal::logger('chat_space')->warning('Mention processing failed: @error', ['@error' => $e->getMessage()]);
      }

      // Son mesajı dön (render için)
      $user = User::load($current_user->id());
      // YENİ: Dinamik default avatar path
      $module_path = \Drupal::service('extension.list.module')->getPath('chat_space');
      $avatar = '/' . $module_path . '/images/default-avatar.png';
      if ($user->user_picture && $user->user_picture->entity) {
        $avatar = \Drupal::service('file_url_generator')->generateAbsoluteString($user->user_picture->entity->getFileUri());
      }

      // YENİ: Mesajı mention formatı ile dön
      $formatted_message = $mention_service->formatMessageWithMentions($msg);

      return new JsonResponse([
        'success' => true,
        'message' => [
          'message_id' => $message->id(),
          'uid' => $user->id(),
          'name' => $user->getDisplayName(),
          'avatar' => $avatar,
          'message' => $msg, // Orijinal mesaj
          'formatted_message' => $formatted_message, // HTML formatlanmış mesaj
          'created' => date('H:i', $message->get('created')->value),
          'can_edit' => $message->canEdit($current_user),
          'can_delete' => $message->canDelete($current_user, $room),
          'is_edited' => false,
          'mentions' => $mentioned_users, // Etiketlenen kullanıcılar
        ]
      ]);
    }
    catch (\Exception $e) {
      // Sadece kritik hataları logla
      \Drupal::logger('chat_space')->error('Error saving message: @error', ['@error' => $e->getMessage()]);
      return new JsonResponse(['error' => 'Mesaj kaydedilemedi: ' . $e->getMessage()], 500);
    }
  }

  /**
   * YENİ: Mesaj düzenleme endpoint'i.
   */
  public function editMessage($room_id, $message_id, Request $request) {
    $current_user = $this->currentUser();
    
    // CSRF token kontrolü
    $token = $request->headers->get('X-CSRF-Token');
    if (!\Drupal::csrfToken()->validate($token, 'chat-space')) {
      return new JsonResponse(['error' => 'Invalid token'], 403);
    }

    // Mesajı yükle
    $message = \Drupal::entityTypeManager()->getStorage('chat_space_message')->load($message_id);
    if (!$message) {
      return new JsonResponse(['error' => 'Mesaj bulunamadı.'], 404);
    }

    // İzin kontrolü - sadece mesaj sahibi düzenleyebilir
    if (!$message->canEdit($current_user)) {
      return new JsonResponse(['error' => 'Bu mesajı düzenleme yetkiniz yok.'], 403);
    }

    $data = json_decode($request->getContent(), TRUE);
    $new_message = trim($data['message'] ?? '');
    
    if (!$new_message) {
      return new JsonResponse(['error' => 'Boş mesaj gönderilemez.'], 400);
    }

    if (strlen($new_message) > 512) {
      return new JsonResponse(['error' => 'Mesaj çok uzun.'], 400);
    }

    try {
      // Mesajı güncelle
      $message->set('message', $new_message);
      $message->set('edited_at', \Drupal::time()->getRequestTime());
      $message->set('edited_by', $current_user->id());
      $message->save();

      // YENİ: Düzenlenen mesajda mention işleme
      $mention_service = \Drupal::service('chat_space.mention_service');
      $formatted_message = $mention_service->formatMessageWithMentions($new_message);

      return new JsonResponse([
        'success' => true,
        'message' => [
          'message_id' => $message->id(),
          'message' => $new_message,
          'formatted_message' => $formatted_message,
          'edited_at' => date('H:i', $message->get('edited_at')->value),
          'is_edited' => true,
        ]
      ]);
    }
    catch (\Exception $e) {
      // Sadece kritik hataları logla
      \Drupal::logger('chat_space')->error('Error editing message: @error', ['@error' => $e->getMessage()]);
      return new JsonResponse(['error' => 'Mesaj düzenlenemedi.'], 500);
    }
  }

  /**
   * YENİ: Mesaj silme endpoint'i.
   */
  public function deleteMessage($room_id, $message_id, Request $request) {
    $current_user = $this->currentUser();
    
    // CSRF token kontrolü
    $token = $request->headers->get('X-CSRF-Token');
    if (!\Drupal::csrfToken()->validate($token, 'chat-space')) {
      return new JsonResponse(['error' => 'Invalid token'], 403);
    }

    // Mesajı yükle
    $message = \Drupal::entityTypeManager()->getStorage('chat_space_message')->load($message_id);
    if (!$message) {
      return new JsonResponse(['error' => 'Mesaj bulunamadı.'], 404);
    }

    // Oda bilgisini yükle (izin kontrolü için)
    $room = \Drupal::entityTypeManager()->getStorage('chat_space_room')->load($room_id);
    if (!$room) {
      return new JsonResponse(['error' => 'Oda bulunamadı.'], 404);
    }

    // İzin kontrolü
    if (!$message->canDelete($current_user, $room)) {
      return new JsonResponse(['error' => 'Bu mesajı silme yetkiniz yok.'], 403);
    }

    try {
      // Mesajı soft delete (status = 0)
      $message->set('status', 0);
      $message->set('edited_at', \Drupal::time()->getRequestTime());
      $message->set('edited_by', $current_user->id());
      $message->save();

      return new JsonResponse([
        'success' => true,
        'message_id' => $message->id(),
      ]);
    }
    catch (\Exception $e) {
      // Sadece kritik hataları logla
      \Drupal::logger('chat_space')->error('Error deleting message: @error', ['@error' => $e->getMessage()]);
      return new JsonResponse(['error' => 'Mesaj silinemedi.'], 500);
    }
  }

  /**
   * AJAX endpoint to fetch last messages - OPTIMIZED FOR REAL-TIME.
   */
  public function loadMessages($room_id, Request $request) {
    // CSRF token kontrolü
    $token = $request->headers->get('X-CSRF-Token');
    if (!\Drupal::csrfToken()->validate($token, 'chat-space')) {
      return new JsonResponse(['error' => 'Invalid token'], 403);
    }

    // Room'un var olup olmadığını kontrol et
    $room = \Drupal::entityTypeManager()->getStorage('chat_space_room')->load($room_id);
    if (!$room) {
      return new JsonResponse(['error' => 'Oda bulunamadı.'], 404);
    }

    $start = (int) $request->query->get('start', 0);
    $since = (int) $request->query->get('since', 0);
    $limit = 50;
    $current_user = $this->currentUser();

    try {
      $query = \Drupal::entityTypeManager()->getStorage('chat_space_message')->getQuery()
        ->accessCheck(FALSE)
        ->condition('room_id', $room_id)
        ->condition('status', 1); // Sadece aktif mesajlar

      if ($since > 0) {
        // SADECE YENİ MESAJLAR
        $query->condition('message_id', $since, '>');
        $query->sort('message_id', 'ASC');
        $query->range(0, 20);
      } else {
        // İLK YÜKLEME
        $query->sort('created', 'DESC');
        $query->range($start, $limit);
      }

      $ids = $query->execute();
      $messages = [];
      
      if ($ids) {
        $msgs = \Drupal::entityTypeManager()->getStorage('chat_space_message')->loadMultiple($ids);

        if ($since == 0) {
          $msgs = array_reverse($msgs);
        }

        // YENİ: N+1 query problemini çöz - tüm kullanıcıları bir seferde yükle
        $user_ids = array_unique(array_map(fn($msg) => $msg->get('uid')->target_id, $msgs));
        $users = User::loadMultiple($user_ids);

        // Mention servisi
        $mention_service = \Drupal::service('chat_space.mention_service');

        // YENİ: Dinamik default avatar path
        $module_path = \Drupal::service('extension.list.module')->getPath('chat_space');
        $default_avatar = '/' . $module_path . '/images/default-avatar.png';

        foreach ($msgs as $msg) {
          $uid = $msg->get('uid')->target_id;
          $user = $users[$uid] ?? NULL;

          if ($user) {
            $avatar = $default_avatar;
            if ($user->user_picture && $user->user_picture->entity) {
              $avatar = \Drupal::service('file_url_generator')->generateAbsoluteString($user->user_picture->entity->getFileUri());
            }

            // YENİ: Mesajı mention formatı ile formatla
            $original_message = $msg->get('message')->value;
            $formatted_message = $mention_service->formatMessageWithMentions($original_message);

            $messages[] = [
              'message_id' => $msg->id(),
              'uid' => $user->id(),
              'name' => $user->getDisplayName(),
              'avatar' => $avatar,
              'message' => $original_message, // Orijinal mesaj
              'formatted_message' => $formatted_message, // HTML formatlanmış mesaj
              'created' => date('H:i', $msg->get('created')->value),
              'created_timestamp' => $msg->get('created')->value,
              'is_edited' => $msg->isEdited(),
              'edited_at' => $msg->isEdited() ? date('H:i', $msg->getEditedTime()) : null,
              'can_edit' => $msg->canEdit($current_user),
              'can_delete' => $msg->canDelete($current_user, $room),
            ];
          }
        }
      }

      return new JsonResponse(['success' => true, 'messages' => $messages]);
    }
    catch (\Exception $e) {
      // Sadece kritik hataları logla
      \Drupal::logger('chat_space')->error('Error loading messages: @error', ['@error' => $e->getMessage()]);
      return new JsonResponse(['error' => 'Mesajlar yüklenemedi.'], 500);
    }
  }
}