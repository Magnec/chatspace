<?php

namespace Drupal\chat_space\Entity;

use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;

/**
 * Defines the Chat Message entity.
 *
 * @ContentEntityType(
 *   id = "chat_space_message",
 *   label = @Translation("Chat Message"),
 *   handlers = {
 *     "list_builder" = "Drupal\Core\Entity\EntityListBuilder",
 *   },
 *   base_table = "chat_space_message",
 *   entity_keys = {
 *     "id" = "message_id",
 *   },
 *   admin_permission = "administer chat space"
 * )
 */
class ChatMessage extends ContentEntityBase {

  public static function baseFieldDefinitions(EntityTypeInterface $entity_type) {
    $fields = parent::baseFieldDefinitions($entity_type);

    $fields['message_id'] = BaseFieldDefinition::create('integer')
      ->setLabel(t('Message ID'))
      ->setReadOnly(TRUE)
      ->setSetting('unsigned', TRUE);

    $fields['room_id'] = BaseFieldDefinition::create('integer')
      ->setLabel(t('Room ID'))
      ->setRequired(TRUE);

    $fields['uid'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(t('User'))
      ->setSetting('target_type', 'user')
      ->setRequired(TRUE)
      ->setDefaultValueCallback('Drupal\chat_space\Entity\ChatMessage::getCurrentUserId');

    $fields['message'] = BaseFieldDefinition::create('string_long')
      ->setLabel(t('Message'))
      ->setRequired(TRUE);

    $fields['created'] = BaseFieldDefinition::create('created')
      ->setLabel(t('Created'));

    // YENİ: Düzenleme zamanı ve kim düzenledi
    $fields['edited_at'] = BaseFieldDefinition::create('timestamp')
      ->setLabel(t('Edited At'))
      ->setDescription(t('The time when the message was last edited.'))
      ->setRequired(FALSE)
      ->setDefaultValue(NULL);

    $fields['edited_by'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(t('Edited By'))
      ->setDescription(t('The user who last edited this message.'))
      ->setSetting('target_type', 'user')
      ->setRequired(FALSE);

    // YENİ: Mesaj durumu (aktif, silinmiş, vs)
    $fields['status'] = BaseFieldDefinition::create('integer')
      ->setLabel(t('Status'))
      ->setDescription(t('Message status: 1 = active, 0 = deleted'))
      ->setDefaultValue(1)
      ->setRequired(TRUE);

    return $fields;
  }

  /**
   * Default value callback for 'uid' base field definition.
   */
  public static function getCurrentUserId() {
    return [\Drupal::currentUser()->id()];
  }

  /**
   * Check if message was edited.
   */
  public function isEdited() {
    return !empty($this->get('edited_at')->value);
  }

  /**
   * Get edit timestamp.
   */
  public function getEditedTime() {
    return $this->get('edited_at')->value;
  }

  /**
   * Get who edited the message.
   */
  public function getEditedBy() {
    if ($this->get('edited_by')->target_id) {
      return $this->get('edited_by')->entity;
    }
    return NULL;
  }

  /**
   * Check if current user can edit this message.
   */
  public function canEdit($user = NULL) {
    if (!$user) {
      $user = \Drupal::currentUser();
    }
    
    // Sadece mesaj sahibi düzenleyebilir
    return $this->get('uid')->target_id == $user->id();
  }

  /**
   * Check if current user can delete this message.
   */
  public function canDelete($user = NULL, $room = NULL) {
    if (!$user) {
      $user = \Drupal::currentUser();
    }
    
    // 1. Mesaj sahibi her zaman silebilir
    if ($this->get('uid')->target_id == $user->id()) {
      return TRUE;
    }
    
    // 2. Site admin'i her zaman silebilir
    if ($user->hasPermission('administer chat space')) {
      return TRUE;
    }
    
    // 3. Oda sahibi silebilir (oda bilgisi lazım)
    if ($room) {
      if ($room->get('owner')->target_id == $user->id()) {
        return TRUE;
      }
    }
    
    // 4. Mesaj silme yetkisi varsa silebilir
    if ($user->hasPermission('delete any chat messages')) {
      return TRUE;
    }
    
    return FALSE;
  }
}