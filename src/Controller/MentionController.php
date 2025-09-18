<?php

namespace Drupal\chat_space\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\chat_space\Service\UserMentionService;

/**
 * Kullanıcı etiketleme ile ilgili controller.
 */
class MentionController extends ControllerBase {

  protected $mentionService;

  public function __construct(UserMentionService $mention_service) {
    $this->mentionService = $mention_service;
  }

  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('chat_space.mention_service')
    );
  }

  /**
   * Kullanıcı adı autocomplete endpoint'i.
   */
  public function usernameAutocomplete($room_id, Request $request) {
    // CSRF token kontrolü
    $token = $request->headers->get('X-CSRF-Token');
    if (!\Drupal::csrfToken()->validate($token, 'chat-space')) {
      return new JsonResponse(['error' => 'Invalid token'], 403);
    }

    $query = trim($request->query->get('q', ''));
    
    try {
      $usernames = $this->mentionService->getUsernamesForAutocomplete($room_id, $query);
      
      return new JsonResponse([
        'success' => true,
        'users' => $usernames,
        'count' => count($usernames)
      ]);
    } catch (\Exception $e) {
      \Drupal::logger('chat_space')->error('Username autocomplete error: @error', ['@error' => $e->getMessage()]);
      return new JsonResponse(['error' => 'Autocomplete failed'], 500);
    }
  }

  /**
   * Kullanıcının okunmamış mention'larını getir.
   */
  public function getUnreadMentions(Request $request) {
    $current_user = $this->currentUser();
    
    if (!$current_user->isAuthenticated()) {
      return new JsonResponse(['error' => 'Not authenticated'], 403);
    }

    try {
      $count = $this->mentionService->getUnreadMentionsCount($current_user->id());
      
      return new JsonResponse([
        'success' => true,
        'unread_count' => $count
      ]);
    } catch (\Exception $e) {
      \Drupal::logger('chat_space')->error('Get unread mentions error: @error', ['@error' => $e->getMessage()]);
      return new JsonResponse(['error' => 'Failed to get mentions'], 500);
    }
  }

  /**
   * Mention bildirimi test endpoint'i (sadece admin için).
   */
  public function testMention($room_id, Request $request) {
    // Sadece admin erişebilir
    if (!$this->currentUser()->hasPermission('administer chat space')) {
      return new JsonResponse(['error' => 'Access denied'], 403);
    }

    $data = json_decode($request->getContent(), TRUE);
    $test_message = $data['message'] ?? '@test kullanıcısı test mesajı';
    $current_user = $this->currentUser();

    try {
      // Test mention işle
      $mentions = $this->mentionService->processMentions(
        $test_message,
        $room_id,
        $current_user->id(),
        999999 // Test message ID
      );

      return new JsonResponse([
        'success' => true,
        'message' => $test_message,
        'mentions_found' => $this->mentionService->extractMentions($test_message),
        'notifications_sent' => $mentions,
        'formatted_message' => $this->mentionService->formatMessageWithMentions($test_message)
      ]);
    } catch (\Exception $e) {
      \Drupal::logger('chat_space')->error('Test mention error: @error', ['@error' => $e->getMessage()]);
      return new JsonResponse(['error' => 'Test failed: ' . $e->getMessage()], 500);
    }
  }
}