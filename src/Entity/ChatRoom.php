<?php

namespace Drupal\chat_space\Entity;

use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Component\Transliteration\PhpTransliteration;

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
 *     "canonical" = "/chat-space/room/{chat_space_room}",
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

    // YENİ: URL slug alanı
    $fields['slug'] = BaseFieldDefinition::create('string')
      ->setLabel(t('URL Slug'))
      ->setDescription(t('URL-friendly version of the room title'))
      ->setSettings(['max_length' => 255])
      ->setRequired(FALSE)
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayConfigurable('view', FALSE);

    return $fields;
  }

  public static function getCurrentUserId() {
    return [\Drupal::currentUser()->id()];
  }

  /**
   * {@inheritdoc}
   */
  public function preSave(EntityStorageInterface $storage) {
    parent::preSave($storage);
    
    // Slug otomatik oluştur/güncelle
    $this->generateSlug();
  }

  /**
   * Başlıktan URL-friendly slug oluştur.
   */
  protected function generateSlug() {
    $title = $this->get('title')->value;
    $current_slug = $this->get('slug')->value;
    
    if (!$title) {
      return;
    }

    // Eğer manuel slug girilmişse ve geçerliyse kullan
    if ($current_slug && $this->isValidSlug($current_slug)) {
      return;
    }

    // Yeni slug oluştur
    $slug = $this->createSlugFromTitle($title);
    
    // Benzersizlik kontrolü
    $unique_slug = $this->ensureUniqueSlug($slug);
    
    // Slug'ı set et
    $this->set('slug', $unique_slug);
  }

  /**
   * Slug'ın geçerli olup olmadığını kontrol et.
   */
  protected function isValidSlug($slug) {
    return preg_match('/^[a-zA-Z0-9\-_]+$/', $slug);
  }

  /**
   * Başlıktan slug oluştur.
   */
  protected function createSlugFromTitle($title) {
    // Türkçe karakterleri dönüştür
    $transliterator = new PhpTransliteration();
    $slug = $transliterator->transliterate($title, 'tr');
    
    // Küçük harfe çevir
    $slug = mb_strtolower($slug, 'UTF-8');
    
    // Özel karakterleri temizle
    $slug = preg_replace('/[^a-z0-9\-_]/', '-', $slug);
    
    // Çoklu tire/alt çizgileri tek tire yap
    $slug = preg_replace('/[-_]+/', '-', $slug);
    
    // Baş ve sondaki tireleri temizle
    $slug = trim($slug, '-_');
    
    // Minimum 1 karakter olsun
    if (empty($slug)) {
      $slug = 'room-' . time();
    }
    
    return $slug;
  }

  /**
   * Benzersiz slug sağla.
   */
  protected function ensureUniqueSlug($slug) {
    $original_slug = $slug;
    $counter = 1;
    
    while ($this->slugExists($slug)) {
      $slug = $original_slug . '-' . $counter;
      $counter++;
    }
    
    return $slug;
  }

  /**
   * Slug'ın kullanımda olup olmadığını kontrol et.
   */
  protected function slugExists($slug) {
    $query = \Drupal::entityTypeManager()
      ->getStorage('chat_space_room')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('slug', $slug);
    
    // Düzenleme durumunda mevcut entity'yi hariç tut
    if (!$this->isNew()) {
      $query->condition('room_id', $this->id(), '<>');
    }
    
    $result = $query->execute();
    return !empty($result);
  }

  /**
   * Slug'ı al.
   */
  public function getSlug() {
    return $this->get('slug')->value;
  }

  /**
   * Slug'a göre oda bul.
   */
  public static function loadBySlug($slug) {
    $entity_ids = \Drupal::entityTypeManager()
      ->getStorage('chat_space_room')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('slug', $slug)
      ->range(0, 1)
      ->execute();
    
    if ($entity_ids) {
      $entity_id = reset($entity_ids);
      return \Drupal::entityTypeManager()
        ->getStorage('chat_space_room')
        ->load($entity_id);
    }
    
    return NULL;
  }

  /**
   * URL'yi oluştur.
   */
  public function toUrl($rel = 'canonical', array $options = []) {
    if ($rel === 'canonical' && $this->getSlug()) {
      return \Drupal\Core\Url::fromRoute('chat_space.room_by_slug', [
        'slug' => $this->getSlug()
      ], $options);
    }
    
    return parent::toUrl($rel, $options);
  }
}