<?php
// Copy this file to config.php and edit it (config.php is used when present).
// Database settings. Edit these to match your phpMyAdmin / MySQL account,
// or set the environment variables of the same name on your server.
return [
    'db_host'   => getenv('TUBEMAKER_DB_HOST') ?: 'localhost',
    'db_port'   => getenv('TUBEMAKER_DB_PORT') ?: '3306',
    'db_name'   => getenv('TUBEMAKER_DB_NAME') ?: 'tubemaker',
    'db_user'   => getenv('TUBEMAKER_DB_USER') ?: 'root',
    'db_pass'   => getenv('TUBEMAKER_DB_PASS') ?: '',

    // Random string used when hashing visitor IPs. Change it once on install.
    'ip_salt'   => getenv('TUBEMAKER_IP_SALT') ?: 'change-me-to-something-random',

    // Limits
    'max_map_bytes'        => 6 * 1024 * 1024,   // editor JSON
    'max_thumb_bytes'      => 4 * 1024 * 1024,   // PNG preview
    'uploads_per_hour'     => 20,                 // per visitor
    'comments_per_hour'    => 30,
    'page_size'            => 24,
];
