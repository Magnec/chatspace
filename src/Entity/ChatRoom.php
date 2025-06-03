<?php

namespace Drupal\chat_space\Entity;

use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;

/**
 * Defines the Chat Room entity.
 *
 * @ContentEntityType(
 *   id = "chat_space_room",
 *   label = @Translation("Chat Room"),
 *   handlers = {
 *     "form" = {
 *       "default" = "Drupal\chat_space\Form\ChatRoomForm",
 *       "add" = "Drupal\chat_space\Form\ChatRoomForm",
 *       "edit" = "Drupal\chat_space\Form\ChatRoomForm",
 *       "delete" = "Drupal\Core\Entity\ContentEntityDeleteForm"
 *     },
 *     "list_builder" = "Drupal\Core\Entity\EntityListBuilder",
 *   },
 *   base_table = "chat_space_room",
 *   entity_keys = {
 *     "id" = "room_id",
 *     "label" = "title",
 *   },
 *   admin_permission = "administer chat space",
 *   links = {
 *     "canonical" = "/chat-space/{chat_space_room}",
 *     "add-form" = "/chat-space/add",
 *     "edit-form" = "/chat-space/{chat_space_room}/edit",
 *     "delete-form" = "/chat-space/{chat_space_room}/delete"
 *   }
 * )
 */

class ChatRoom extends ContentEntityBase {

  public static function baseFieldDefinitions(EntityTypeInterface $entity_type) {
    $fields = parent::baseFieldDefinitions($entity_type);

    $fields['room_id'] = BaseFieldDefinition::create('integer')
      ->setLabel(t('Room ID'))
      ->setReadOnly(TRUE)
      ->setSetting('unsigned', TRUE);

    $fields['title'] = BaseFieldDefinition::create('string')
      ->setLabel(t('Title'))
      ->setRequired(TRUE)
      ->setSettings(['max_length' => 255]);

    $fields['description'] = BaseFieldDefinition::create('string_long')
      ->setLabel(t('Description'))
      ->setRequired(FALSE);

    $fields['owner'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(t('Owner'))
      ->setRequired(TRUE)
      ->setSetting('target_type', 'user')
      ->setDefaultValueCallback('Drupal\chat_space\Entity\ChatRoom::getCurrentUserId');

    $fields['created'] = BaseFieldDefinition::create('created')
      ->setLabel(t('Created'));

    $fields['visibility'] = BaseFieldDefinition::create('integer')
      ->setLabel(t('Visibility'))
      ->setDefaultValue(0);

    return $fields;
  }

  public static function getCurrentUserId() {
    return [\Drupal::currentUser()->id()];
  }
}
