<?php

namespace Drupal\chat_space\Form;

use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Form\FormStateInterface;

class ChatRoomForm extends ContentEntityForm {

  public function buildForm(array $form, FormStateInterface $form_state) {
    /** @var \Drupal\chat_space\Entity\ChatRoom $entity */
    $form = parent::buildForm($form, $form_state);
    $entity = $this->entity;

    $form['title'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Room Title'),
      '#default_value' => $entity->get('title')->value ?? '',
      '#required' => TRUE,
      '#maxlength' => 255,
      '#description' => $this->t('The display name for this chat room.'),
    ];

    $form['description'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Description'),
      '#default_value' => $entity->get('description')->value ?? '',
      '#required' => FALSE,
      '#rows' => 3,
      '#description' => $this->t('Optional description of the chat room.'),
    ];

    // YENİ: Slug alanı (isteğe bağlı, otomatik oluşturulur)
    $form['slug'] = [
      '#type' => 'textfield',
      '#title' => $this->t('URL Slug'),
      '#default_value' => $entity->get('slug')->value ?? '',
      '#required' => FALSE,
      '#maxlength' => 255,
      '#description' => $this->t('URL-friendly version of the room name. If left empty, it will be generated automatically from the title. Only use letters, numbers, hyphens and underscores.'),
      '#pattern' => '[a-zA-Z0-9\-_]+',
      '#placeholder' => $this->t('Leave empty for automatic generation'),
    ];

    $form['visibility'] = [
      '#type' => 'select',
      '#title' => $this->t('Visibility'),
      '#options' => [
        0 => $this->t('Public'),
        1 => $this->t('Private'),
      ],
      '#default_value' => $entity->get('visibility')->value ?? 0,
      '#description' => $this->t('Private rooms are only visible to invited users.'),
    ];

    // Owner field'ını gizle (otomatik olarak mevcut kullanıcı olacak)
    if (isset($form['owner'])) {
      $form['owner']['#access'] = FALSE;
    }

    // Slug alanı için JavaScript ekleme
    $form['#attached']['library'][] = 'chat_space/admin';
    $form['#attached']['drupalSettings']['chatSpace']['slugGeneration'] = TRUE;

    return $form;
  }

  public function validateForm(array &$form, FormStateInterface $form_state) {
    parent::validateForm($form, $form_state);
    
    // Title'ın benzersiz olup olmadığını kontrol et
    $title = $form_state->getValue('title');
    if ($title) {
      $query = \Drupal::entityTypeManager()->getStorage('chat_space_room')->getQuery()
        ->accessCheck(FALSE)
        ->condition('title', $title);
      
      // Edit durumunda mevcut entity'yi hariç tut
      if (!$this->entity->isNew()) {
        $query->condition('room_id', $this->entity->id(), '<>');
      }
      
      $existing = $query->execute();
      if ($existing) {
        $form_state->setErrorByName('title', $this->t('A room with this title already exists.'));
      }
    }
    
    // Slug validasyonu
    $slug = trim($form_state->getValue('slug'));
    if ($slug) {
      // Slug formatını kontrol et
      if (!preg_match('/^[a-zA-Z0-9\-_]+$/', $slug)) {
        $form_state->setErrorByName('slug', $this->t('URL slug can only contain letters, numbers, hyphens and underscores.'));
      }
      
      // Slug'ın benzersiz olup olmadığını kontrol et
      $query = \Drupal::entityTypeManager()->getStorage('chat_space_room')->getQuery()
        ->accessCheck(FALSE)
        ->condition('slug', $slug);
      
      // Edit durumunda mevcut entity'yi hariç tut
      if (!$this->entity->isNew()) {
        $query->condition('room_id', $this->entity->id(), '<>');
      }
      
      $existing = $query->execute();
      if ($existing) {
        $form_state->setErrorByName('slug', $this->t('This URL slug is already in use. Please choose a different one.'));
      }
      
      // Yasaklı slug'ları kontrol et
      $reserved_slugs = ['add', 'edit', 'delete', 'admin', 'api', 'debug', 'test'];
      if (in_array(strtolower($slug), $reserved_slugs)) {
        $form_state->setErrorByName('slug', $this->t('This URL slug is reserved and cannot be used.'));
      }
    }
  }

  public function save(array $form, FormStateInterface $form_state) {
    $entity = $this->entity;
    
    // Yeni oda ise owner'ı set et
    if ($entity->isNew()) {
      $entity->set('owner', $this->currentUser()->id());
      $entity->set('created', \Drupal::time()->getRequestTime());
    }
    
    // Slug işleme - manuel girilmişse kullan, yoksa otomatik oluştur
    $manual_slug = trim($form_state->getValue('slug'));
    if ($manual_slug) {
      $entity->set('slug', $manual_slug);
    }
    // Slug boşsa entity'nin preSave metodunda otomatik oluşturulacak
    
    $status = parent::save($form, $form_state);

    $slug = $entity->getSlug();
    $room_url = $slug ? 
      \Drupal\Core\Url::fromRoute('chat_space.room_by_slug', ['slug' => $slug]) :
      \Drupal\Core\Url::fromRoute('chat_space.room', ['room_id' => $entity->id()]);

    if ($status == SAVED_NEW) {
      $this->messenger()->addMessage($this->t('Sohbet odası "@title" oluşturuldu. <a href="@url">Odaya git</a>', [
        '@title' => $entity->label(),
        '@url' => $room_url->toString(),
      ]));
    }
    else {
      $this->messenger()->addMessage($this->t('Sohbet odası "@title" güncellendi. <a href="@url">Odaya git</a>', [
        '@title' => $entity->label(),
        '@url' => $room_url->toString(),
      ]));
    }

    $form_state->setRedirect('chat_space.rooms');
  }
}