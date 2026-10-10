-- TubeMaker database schema
-- Import this file in phpMyAdmin (Import tab) or run:  mysql -u root -p < database/schema.sql
-- Creates the `tubemaker` database and everything the PHP API needs.

CREATE DATABASE IF NOT EXISTS `tubemaker`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `tubemaker`;

-- Maps published to the community page.
CREATE TABLE IF NOT EXISTS `maps` (
  `id`           INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `slug`         CHAR(10)         NOT NULL,                 -- short public id used in links
  `title`        VARCHAR(120)     NOT NULL,
  `author`       VARCHAR(60)      NOT NULL DEFAULT 'Anonymous',
  `description`  TEXT             NULL,
  `map_json`     LONGTEXT         NOT NULL,                 -- full editor document (lines, stations, zones...)
  `thumbnail`    MEDIUMBLOB       NULL,                     -- PNG preview shown in the gallery
  `station_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `line_count`   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `likes`        INT UNSIGNED     NOT NULL DEFAULT 0,
  `views`        INT UNSIGNED     NOT NULL DEFAULT 0,
  `remix_of`     INT UNSIGNED     NULL,                     -- maps.id this map was remixed from
  `edit_token`   CHAR(64)         NOT NULL,                 -- sha256 of the secret given to the uploader
  `ip_hash`      CHAR(64)         NOT NULL,                 -- sha256 of uploader IP + salt (rate limiting)
  `is_hidden`    TINYINT(1)       NOT NULL DEFAULT 0,       -- moderation: hide from gallery
  `created_at`   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_maps_slug` (`slug`),
  KEY `ix_maps_created` (`created_at`),
  KEY `ix_maps_likes` (`likes`),
  KEY `ix_maps_ip` (`ip_hash`, `created_at`),
  FULLTEXT KEY `ft_maps_search` (`title`, `author`, `description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One like per visitor per map.
CREATE TABLE IF NOT EXISTS `map_likes` (
  `map_id`     INT UNSIGNED NOT NULL,
  `ip_hash`    CHAR(64)     NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`map_id`, `ip_hash`),
  CONSTRAINT `fk_likes_map` FOREIGN KEY (`map_id`) REFERENCES `maps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comments on community maps.
CREATE TABLE IF NOT EXISTS `map_comments` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `map_id`     INT UNSIGNED NOT NULL,
  `author`     VARCHAR(60)  NOT NULL DEFAULT 'Anonymous',
  `body`       VARCHAR(1000) NOT NULL,
  `ip_hash`    CHAR(64)     NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_comments_map` (`map_id`, `created_at`),
  CONSTRAINT `fk_comments_map` FOREIGN KEY (`map_id`) REFERENCES `maps` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Custom line presets people have saved and shared (name + colour + style).
CREATE TABLE IF NOT EXISTS `line_presets` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(60)  NOT NULL,
  `color`      CHAR(7)      NOT NULL,
  `style`      ENUM('solid','double','dashed','dotted') NOT NULL DEFAULT 'solid',
  `uses`       INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_preset` (`name`, `color`, `style`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
