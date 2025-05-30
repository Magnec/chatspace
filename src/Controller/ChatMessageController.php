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
    // Debug user info
    $current_user = $this->currentUser();
    \Drupal::logger('chat_space')->info('Send message attempt: User=@uid (@name), Room=@room', [
      '@uid' => $current_user->id(),
      '@name' => $current_user->getDisplayName(),
      '@room' => $room_id,
    ]);

    // CSRF token kontrolü
    $token = $request->headers->get('X-CSRF-Token');
    if (!\Drupal::csrfToken()->validate($token, 'chat-space')) {
      \Drupal::logger('chat_space')->error('Invalid CSRF token for user @uid', ['@uid' => $current_user->id()]);
      return new JsonResponse(['error' => 'Invalid token'], 403);
    }

    // Permission kontrolü - geçici olarak kapalı
    /*
    if (!$current_user->hasPermission('send chat messages')) {
      \Drupal::logger('chat_space')->error('No permission to send messages for user @uid', ['@uid' => $current_user->id()]);
      return new JsonResponse(['error' => 'Access denied'], 403);
    }
    */

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
      // Mesajı kaydet - Entity create permission bypass
      $message = ChatMessage::create([
        'room_id' => $room_id,
        'uid' => $current_user->id(),
        'message' => $msg,
        'created' => \Drupal::time()->getRequestTime(),
      ]);
      
      // Entity save permission bypass
      $violation = $message->validate();
      if ($violation->count() > 0) {
        $error_msg = [];
        foreach ($violation as $v) {
          $error_msg[] = $v->getMessage();
        }
        \Drupal::logger('chat_space')->error('Message validation failed: @errors', ['@errors' => implode(', ', $error_msg)]);
        return new JsonResponse(['error' => 'Mesaj doğrulanamadı: ' . implode(', ', $error_msg)], 400);
      }
      
      $message->save();
      
      \Drupal::logger('chat_space')->info('Message saved: ID=@id for user @uid', [
        '@id' => $message->id(),
        '@uid' => $current_user->id(),
      ]);

      // Son mesajı dön (render için)
      $user = User::load($current_user->id());
      $avatar = '/core/themes/stable9/images/avatar.png';
      if ($user->user_picture && $user->user_picture->entity) {
        $avatar = \Drupal::service('file_url_generator')->generateAbsoluteString($user->user_picture->entity->getFileUri());
      }

      return new JsonResponse([
        'success' => true,
        'message' => [
          'message_id' => $message->id(),
          'uid' => $user->id(),
          'name' => $user->getDisplayName(),
          'avatar' => $avatar,
          'message' => $msg,
          'created' => date('H:i', $message->get('created')->value),
        ]
      ]);
    }
    catch (\Exception $e) {
      \Drupal::logger('chat_space')->error('Error saving message: @error', ['@error' => $e->getMessage()]);
      return new JsonResponse(['error' => 'Mesaj kaydedilemedi: ' . $e->getMessage()], 500);
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
    $since = (int) $request->query->get('since', 0); // Yeni mesajlar için - REAL-TIME OPTIMIZATION
    $limit = 50;

    // Debug log ekle
    \Drupal::logger('chat_space')->info('Loading messages: room=@room, since=@since, start=@start', [
      '@room' => $room_id,
      '@since' => $since,
      '@start' => $start,
    ]);

    try {
      $query = \Drupal::entityTypeManager()->getStorage('chat_space_message')->getQuery()
        ->accessCheck(FALSE)
        ->condition('room_id', $room_id);

      if ($since > 0) {
        // SADECE YENİ MESAJLAR - çok hızlı polling için
        $query->condition('message_id', $since, '>');
        $query->sort('message_id', 'ASC'); // Yeni mesajlar için sıralama
        $query->range(0, 20); // Maksimum 20 yeni mesaj
        
        \Drupal::logger('chat_space')->info('Fetching NEW messages since @since', ['@since' => $since]);
      } else {
        // İLK YÜKLEME - tüm mesajları getir
        $query->sort('created', 'DESC');
        $query->range($start, $limit);
        
        \Drupal::logger('chat_space')->info('Fetching ALL messages with pagination start=@start', ['@start' => $start]);
      }

      $ids = $query->execute();
      $messages = [];
      
      \Drupal::logger('chat_space')->info('Found @count message IDs: @ids', [
        '@count' => count($ids),
        '@ids' => implode(', ', $ids),
      ]);
      
      if ($ids) {
        $msgs = \Drupal::entityTypeManager()->getStorage('chat_space_message')->loadMultiple($ids);
        
        // Eğer since kullanılmıyorsa mesajları ters çevir (eski->yeni)
        if ($since == 0) {
          $msgs = array_reverse($msgs);
        }
        
        foreach ($msgs as $msg) {
          $user = User::load($msg->get('uid')->target_id);
          if ($user) {
            $avatar = '/core/themes/stable9/images/avatar.png';
            if ($user->user_picture && $user->user_picture->entity) {
              $avatar = \Drupal::service('file_url_generator')->generateAbsoluteString($user->user_picture->entity->getFileUri());
            }
            
            $messages[] = [
              'message_id' => $msg->id(),
              'uid' => $user->id(),
              'name' => $user->getDisplayName(),
              'avatar' => $avatar,
              'message' => $msg->get('message')->value,
              'created' => date('H:i', $msg->get('created')->value),
              'created_timestamp' => $msg->get('created')->value,
            ];
            
            \Drupal::logger('chat_space')->info('Message processed: ID=@id, User=@user, Text=@text', [
              '@id' => $msg->id(),
              '@user' => $user->getDisplayName(),
              '@text' => substr($msg->get('message')->value, 0, 50),
            ]);
          }
        }
      }

      \Drupal::logger('chat_space')->info('Returning @count messages', ['@count' => count($messages)]);
      return new JsonResponse(['success' => true, 'messages' => $messages]);
    }
    catch (\Exception $e) {
      \Drupal::logger('chat_space')->error('Error loading messages: @error', ['@error' => $e->getMessage()]);
      return new JsonResponse(['error' => 'Mesajlar yüklenemedi.'], 500);
    }
  }
}