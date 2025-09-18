<?php

namespace Drupal\chat_space\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * Debug controller for testing chat space functionality.
 */
class DebugController extends ControllerBase {

  /**
   * Test endpoint to check if module is working.
   */
  public function test(Request $request) {
    $data = [];
    
    // Test 1: Check if tables exist
    try {
      $room_count = \Drupal::database()->select('chat_space_room', 'r')->countQuery()->execute()->fetchField();
      $message_count = \Drupal::database()->select('chat_space_message', 'm')->countQuery()->execute()->fetchField();
      $data['database'] = [
        'rooms' => $room_count,
        'messages' => $message_count,
        'status' => 'OK'
      ];
    } catch (\Exception $e) {
      $data['database'] = [
        'error' => $e->getMessage(),
        'status' => 'ERROR'
      ];
    }
    
    // Test 2: Check CSRF token
    $token = \Drupal::csrfToken()->get('chat-space');
    $data['csrf'] = [
      'token' => substr($token, 0, 10) . '...',
      'valid' => !empty($token),
      'full_token' => $token, // Debug için tam token
    ];
    
    // Test 3: Check current user
    $user = \Drupal::currentUser();
    $data['user'] = [
      'uid' => $user->id(),
      'name' => $user->getDisplayName(),
      'authenticated' => $user->isAuthenticated(),
      'permissions' => [
        'access_chat_rooms' => $user->hasPermission('access chat rooms'),
        'send_chat_messages' => $user->hasPermission('send chat messages'),
        'create_chat_rooms' => $user->hasPermission('create chat rooms'),
      ]
    ];
    
    // Test 4: Check entity queries
    try {
      $room_query = \Drupal::entityTypeManager()->getStorage('chat_space_room')->getQuery()
        ->accessCheck(FALSE)
        ->range(0, 1);
      $room_ids = $room_query->execute();
      $data['entity_query'] = [
        'room_query_works' => true,
        'sample_room_ids' => array_values($room_ids)
      ];
    } catch (\Exception $e) {
      $data['entity_query'] = [
        'room_query_works' => false,
        'error' => $e->getMessage()
      ];
    }
    
    // Test 5: Check if we can create a test message
    if (!empty($room_ids)) {
      try {
        $test_room_id = reset($room_ids);
        $message_query = \Drupal::entityTypeManager()->getStorage('chat_space_message')->getQuery()
          ->accessCheck(FALSE)
          ->condition('room_id', $test_room_id)
          ->range(0, 1);
        $message_ids = $message_query->execute();
        $data['test_queries'] = [
          'message_query_works' => true,
          'test_room_id' => $test_room_id,
          'sample_message_ids' => array_values($message_ids)
        ];
      } catch (\Exception $e) {
        $data['test_queries'] = [
          'message_query_works' => false,
          'error' => $e->getMessage()
        ];
      }
    }
    
    return new JsonResponse($data);
  }

  /**
   * Test message sending without complex logic.
   */
  public function testSend($room_id, Request $request) {
    $current_user = \Drupal::currentUser();
    
    $data = [
      'timestamp' => date('Y-m-d H:i:s'),
      'user' => [
        'uid' => $current_user->id(),
        'name' => $current_user->getDisplayName(),
        'authenticated' => $current_user->isAuthenticated(),
      ],
      'permissions' => [
        'send_chat_messages' => $current_user->hasPermission('send chat messages'),
        'access_chat_rooms' => $current_user->hasPermission('access chat rooms'),
        'admin' => $current_user->hasPermission('administer chat space'),
      ],
      'request' => [
        'method' => $request->getMethod(),
        'content_type' => $request->headers->get('Content-Type'),
        'has_csrf_token' => !empty($request->headers->get('X-CSRF-Token')),
        'token_preview' => substr($request->headers->get('X-CSRF-Token', ''), 0, 10) . '...',
      ],
      'csrf' => [
        'token_from_request' => substr($request->headers->get('X-CSRF-Token', ''), 0, 10) . '...',
        'valid_token' => \Drupal::csrfToken()->validate($request->headers->get('X-CSRF-Token'), 'chat-space'),
        'expected_token_preview' => substr(\Drupal::csrfToken()->get('chat-space'), 0, 10) . '...',
      ],
      'room_id' => $room_id,
    ];
    
    if ($request->getMethod() === 'POST') {
      $content = $request->getContent();
      $json_data = json_decode($content, TRUE);
      $data['post_data'] = [
        'raw_content' => $content,
        'json_decoded' => $json_data,
        'message' => $json_data['message'] ?? 'NOT_FOUND',
      ];
    }
    
    return new JsonResponse($data);
  }

  /**
   * YENİ: Token endpoint - JavaScript için fresh token.
   */
  public function getToken(Request $request) {
    $user = \Drupal::currentUser();
    
    if (!$user->isAuthenticated()) {
      return new JsonResponse(['error' => 'Must be logged in'], 403);
    }
    
    $token = \Drupal::csrfToken()->get('chat-space');
    
    return new JsonResponse([
      'token' => $token,
      'uid' => $user->id(),
      'name' => $user->getDisplayName(),
      'timestamp' => time(),
    ]);
  }

  /**
   * YENİ: Simple users test endpoint.
   */
  public function testUsers($room_id, Request $request) {
    $token = $request->headers->get('X-CSRF-Token');
    $valid_token = \Drupal::csrfToken()->validate($token, 'chat-space');
    
    $current_user = \Drupal::currentUser();
    
    $data = [
      'room_id' => $room_id,
      'token_valid' => $valid_token,
      'token_preview' => substr($token, 0, 10) . '...',
      'current_user' => [
        'uid' => $current_user->id(),
        'name' => $current_user->getDisplayName(),
        'authenticated' => $current_user->isAuthenticated(),
      ],
    ];
    
    if (!$valid_token) {
      $data['error'] = 'Invalid CSRF token';
      return new JsonResponse($data, 403);
    }
    
    try {
      // Basit kullanıcı listesi
      $users = [
        [
          'uid' => $current_user->id(),
          'name' => $current_user->getDisplayName(),
          'avatar' => '/core/themes/stable9/images/avatar.png',
          'status' => 'active',
          'status_text' => 'Bu odada aktif',
          'is_online' => true,
          'in_room' => true,
        ]
      ];
      
      $data['users'] = $users;
      $data['success'] = true;
      
    } catch (\Exception $e) {
      $data['error'] = $e->getMessage();
      $data['users'] = [];
    }
    
    return new JsonResponse($data);
  }
}