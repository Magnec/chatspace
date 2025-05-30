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
    ];

    $form['description'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Description'),
      '#default_value' => $entity->get('description')->value ?? '',
      '#required' => FALSE,
      '#rows' => 3,
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
  }

  public function save(array $form, FormStateInterface $form_state) {
    $entity = $this->entity;
    
    // Yeni oda ise owner'ı set et
    if ($entity->isNew()) {
      $entity->set('owner', $this->currentUser()->id());
      $entity->set('created', \Drupal::time()->getRequestTime());
    }
    
    $status = parent::save($form, $form_state);

    if ($status == SAVED_NEW) {
      $this->messenger()->addMessage($this->t('Sohbet odası "@title" oluşturuldu.', [
        '@title' => $entity->label()
      ]));
    }
    else {
      $this->messenger()->addMessage($this->t('Sohbet odası "@title" güncellendi.', [
        '@title' => $entity->label()
      ]));
    }

    $form_state->setRedirect('chat_space.rooms');
  }
}