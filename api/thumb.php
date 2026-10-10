<?php
// Serves a community map's PNG preview straight from MySQL.
declare(strict_types=1);

require __DIR__ . '/db.php';

$slug = (string)($_GET['id'] ?? '');
try {
    $st = db()->prepare('SELECT thumbnail, updated_at FROM maps WHERE slug = ? AND is_hidden = 0');
    $st->execute([$slug]);
    $row = $st->fetch();
} catch (PDOException $e) {
    http_response_code(500);
    exit;
}

if (!$row || $row['thumbnail'] === null) {
    // 1x1 transparent placeholder
    header('Content-Type: image/png');
    header('Cache-Control: public, max-age=60');
    echo base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');
    exit;
}

$etag = '"' . md5($slug . $row['updated_at']) . '"';
header('ETag: ' . $etag);
header('Cache-Control: public, max-age=86400');
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    exit;
}
header('Content-Type: image/png');
header('Content-Length: ' . strlen($row['thumbnail']));
echo $row['thumbnail'];
