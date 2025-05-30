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

    return $fields;
  }

  /**
   * Default value callback for 'uid' base field definition.
   */
  public static function getCurrentUserId() {
    return [\Drupal::currentUser()->id()];
  }
}
