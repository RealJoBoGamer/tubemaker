<?php
/**
 * Community map API.
 *
 *   GET  api/maps.php?action=list&sort=new|popular|views&q=&page=1
 *   GET  api/maps.php?action=get&id=<slug>
 *   GET  api/maps.php?action=comments&id=<slug>
 *   POST api/maps.php?action=create     {title, author, description, data, thumbnail, remix_of}
 *   POST api/maps.php?action=update     {id, token, title, author, description, data, thumbnail}
 *   POST api/maps.php?action=delete     {id, token}
 *   POST api/maps.php?action=like       {id}
 *   POST api/maps.php?action=comment    {id, author, body}
 *   GET  api/maps.php?action=presets
 *   POST api/maps.php?action=preset     {name, color, style}
 */
declare(strict_types=1);

require __DIR__ . '/db.php';

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    switch ("$method $action") {
        case 'GET list':     action_list(); break;
        case 'GET get':      action_get(); break;
        case 'GET comments': action_comments(); break;
        case 'GET presets':  action_presets(); break;
        case 'POST create':  action_create(); break;
        case 'POST update':  action_update(); break;
        case 'POST delete':  action_delete(); break;
        case 'POST like':    action_like(); break;
        case 'POST comment': action_comment(); break;
        case 'POST preset':  action_save_preset(); break;
        default:             fail('Unknown action.', 404);
    }
} catch (PDOException $e) {
    error_log('tubemaker: ' . $e->getMessage());
    fail('Database error. Check api/config.php and that database/schema.sql has been imported.', 500);
}

function map_row_public(array $r): array
{
    return [
        'id'           => $r['slug'],
        'title'        => $r['title'],
        'author'       => $r['author'],
        'description'  => $r['description'] ?? '',
        'stations'     => (int)$r['station_count'],
        'lines'        => (int)$r['line_count'],
        'likes'        => (int)$r['likes'],
        'views'        => (int)$r['views'],
        'remix_of'     => $r['remix_slug'] ?? null,
        'created_at'   => $r['created_at'],
        'updated_at'   => $r['updated_at'],
        'thumbnail'    => 'api/thumb.php?id=' . rawurlencode($r['slug']) . '&v=' . strtotime($r['updated_at']),
    ];
}

function find_map(string $slug): ?array
{
    $st = db()->prepare('SELECT m.*, r.slug AS remix_slug FROM maps m LEFT JOIN maps r ON r.id = m.remix_of
                         WHERE m.slug = ? AND m.is_hidden = 0');
    $st->execute([$slug]);
    $row = $st->fetch();
    return $row ?: null;
}

function action_list(): void
{
    $cfg = config();
    $page = max(1, (int)($_GET['page'] ?? 1));
    $size = $cfg['page_size'];
    $q = clean_text($_GET['q'] ?? '', 100);
    $order = match ($_GET['sort'] ?? 'new') {
        'popular' => 'm.likes DESC, m.created_at DESC',
        'views'   => 'm.views DESC, m.created_at DESC',
        default   => 'm.created_at DESC',
    };
    $where = 'm.is_hidden = 0';
    $params = [];
    if ($q !== '') {
        $where .= ' AND (m.title LIKE ? OR m.author LIKE ? OR m.description LIKE ?)';
        $like = '%' . addcslashes($q, '%_\\') . '%';
        array_push($params, $like, $like, $like);
    }
    $count = db()->prepare("SELECT COUNT(*) FROM maps m WHERE $where");
    $count->execute($params);
    $total = (int)$count->fetchColumn();

    $offset = ($page - 1) * $size;
    $st = db()->prepare("SELECT m.id, m.slug, m.title, m.author, m.description, m.station_count, m.line_count,
                                m.likes, m.views, m.created_at, m.updated_at, r.slug AS remix_slug
                         FROM maps m LEFT JOIN maps r ON r.id = m.remix_of
                         WHERE $where ORDER BY $order LIMIT $size OFFSET $offset");
    $st->execute($params);
    $maps = array_map('map_row_public', $st->fetchAll());
    json_out(['ok' => true, 'maps' => $maps, 'page' => $page, 'pages' => max(1, (int)ceil($total / $size)), 'total' => $total]);
}

function action_get(): void
{
    $row = find_map((string)($_GET['id'] ?? ''));
    if (!$row) {
        fail('Map not found.', 404);
    }
    db()->prepare('UPDATE maps SET views = views + 1, updated_at = updated_at WHERE id = ?')->execute([$row['id']]);
    $out = map_row_public($row);
    $out['views']++;
    $out['data'] = json_decode($row['map_json'], true);
    $liked = db()->prepare('SELECT 1 FROM map_likes WHERE map_id = ? AND ip_hash = ?');
    $liked->execute([$row['id'], client_hash()]);
    $out['liked'] = (bool)$liked->fetchColumn();
    json_out(['ok' => true, 'map' => $out]);
}

/** Validate an editor document and return [json, stationCount, lineCount]. */
function validate_map_data($data): array
{
    if (!is_array($data) || !isset($data['stations'], $data['lines']) || !is_array($data['stations']) || !is_array($data['lines'])) {
        fail('Map data is missing stations or lines.');
    }
    if (count($data['stations']) > 5000 || count($data['lines']) > 200) {
        fail('Map is too big (max 5000 stations, 200 lines).');
    }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || strlen($json) > config()['max_map_bytes']) {
        fail('Map data is too large.', 413);
    }
    return [$json, count($data['stations']), count($data['lines'])];
}

function decode_thumbnail($dataUrl): ?string
{
    if (!is_string($dataUrl) || $dataUrl === '') {
        return null;
    }
    if (!preg_match('#^data:image/png;base64,([A-Za-z0-9+/=]+)$#', $dataUrl, $m)) {
        fail('Thumbnail must be a PNG data URL.');
    }
    $bin = base64_decode($m[1], true);
    if ($bin === false || strlen($bin) > config()['max_thumb_bytes']) {
        fail('Thumbnail is too large.', 413);
    }
    if (substr($bin, 0, 8) !== "\x89PNG\r\n\x1a\n") {
        fail('Thumbnail is not a PNG image.');
    }
    return $bin;
}

function require_token(array $body): array
{
    $row = find_map((string)($body['id'] ?? ''));
    if (!$row) {
        fail('Map not found.', 404);
    }
    $token = (string)($body['token'] ?? '');
    if ($token === '' || !hash_equals($row['edit_token'], hash('sha256', $token))) {
        fail('You do not have permission to change this map.', 403);
    }
    return $row;
}

function action_create(): void
{
    $body = read_json_body();
    $cfg = config();
    $ip = client_hash();

    $recent = db()->prepare('SELECT COUNT(*) FROM maps WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL 1 HOUR)');
    $recent->execute([$ip]);
    if ((int)$recent->fetchColumn() >= $cfg['uploads_per_hour']) {
        fail('Upload limit reached, please try again later.', 429);
    }

    $title = clean_text($body['title'] ?? '', 120);
    if ($title === '') {
        fail('Please give your map a title.');
    }
    $author = clean_text($body['author'] ?? '', 60, 'Anonymous');
    $desc = clean_text($body['description'] ?? '', 2000);
    [$json, $nStations, $nLines] = validate_map_data($body['data'] ?? null);
    $thumb = decode_thumbnail($body['thumbnail'] ?? '');

    $remixOf = null;
    if (!empty($body['remix_of'])) {
        $src = find_map((string)$body['remix_of']);
        $remixOf = $src ? (int)$src['id'] : null;
    }

    $token = bin2hex(random_bytes(24));
    for ($i = 0; $i < 5; $i++) {
        $slug = new_slug();
        try {
            $st = db()->prepare('INSERT INTO maps (slug, title, author, description, map_json, thumbnail, station_count, line_count,
                                                   remix_of, edit_token, ip_hash)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $st->bindValue(1, $slug);
            $st->bindValue(2, $title);
            $st->bindValue(3, $author);
            $st->bindValue(4, $desc);
            $st->bindValue(5, $json);
            $st->bindValue(6, $thumb, $thumb === null ? PDO::PARAM_NULL : PDO::PARAM_LOB);
            $st->bindValue(7, $nStations, PDO::PARAM_INT);
            $st->bindValue(8, $nLines, PDO::PARAM_INT);
            $st->bindValue(9, $remixOf, $remixOf === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
            $st->bindValue(10, hash('sha256', $token));
            $st->bindValue(11, $ip);
            $st->execute();
            json_out(['ok' => true, 'id' => $slug, 'token' => $token], 201);
        } catch (PDOException $e) {
            if ($e->errorInfo[1] ?? null) {
                if ((int)$e->errorInfo[1] === 1062) {
                    continue; // slug collision, try another
                }
            }
            throw $e;
        }
    }
    fail('Could not allocate an id, please retry.', 500);
}

function action_update(): void
{
    $body = read_json_body();
    $row = require_token($body);
    $title = clean_text($body['title'] ?? $row['title'], 120, $row['title']);
    $author = clean_text($body['author'] ?? $row['author'], 60, $row['author']);
    $desc = clean_text($body['description'] ?? $row['description'], 2000);
    $sql = 'UPDATE maps SET title = ?, author = ?, description = ?';
    $params = [$title, $author, $desc];
    if (isset($body['data'])) {
        [$json, $nStations, $nLines] = validate_map_data($body['data']);
        $sql .= ', map_json = ?, station_count = ?, line_count = ?';
        array_push($params, $json, $nStations, $nLines);
    }
    $thumb = decode_thumbnail($body['thumbnail'] ?? '');
    if ($thumb !== null) {
        $sql .= ', thumbnail = ?';
        $params[] = $thumb;
    }
    $sql .= ' WHERE id = ?';
    $params[] = $row['id'];
    db()->prepare($sql)->execute($params);
    json_out(['ok' => true, 'id' => $row['slug']]);
}

function action_delete(): void
{
    $body = read_json_body();
    $row = require_token($body);
    db()->prepare('DELETE FROM maps WHERE id = ?')->execute([$row['id']]);
    json_out(['ok' => true]);
}

function action_like(): void
{
    $body = read_json_body();
    $row = find_map((string)($body['id'] ?? ''));
    if (!$row) {
        fail('Map not found.', 404);
    }
    $pdo = db();
    $ins = $pdo->prepare('INSERT IGNORE INTO map_likes (map_id, ip_hash) VALUES (?, ?)');
    $ins->execute([$row['id'], client_hash()]);
    if ($ins->rowCount() > 0) {
        $pdo->prepare('UPDATE maps SET likes = likes + 1, updated_at = updated_at WHERE id = ?')->execute([$row['id']]);
        $liked = true;
    } else {
        // second click removes the like
        $pdo->prepare('DELETE FROM map_likes WHERE map_id = ? AND ip_hash = ?')->execute([$row['id'], client_hash()]);
        $pdo->prepare('UPDATE maps SET likes = GREATEST(likes, 1) - 1, updated_at = updated_at WHERE id = ?')->execute([$row['id']]);
        $liked = false;
    }
    $n = $pdo->prepare('SELECT likes FROM maps WHERE id = ?');
    $n->execute([$row['id']]);
    json_out(['ok' => true, 'liked' => $liked, 'likes' => (int)$n->fetchColumn()]);
}

function action_comments(): void
{
    $row = find_map((string)($_GET['id'] ?? ''));
    if (!$row) {
        fail('Map not found.', 404);
    }
    $st = db()->prepare('SELECT id, author, body, created_at FROM map_comments WHERE map_id = ? ORDER BY created_at DESC LIMIT 200');
    $st->execute([$row['id']]);
    json_out(['ok' => true, 'comments' => $st->fetchAll()]);
}

function action_comment(): void
{
    $body = read_json_body();
    $row = find_map((string)($body['id'] ?? ''));
    if (!$row) {
        fail('Map not found.', 404);
    }
    $text = clean_text($body['body'] ?? '', 1000);
    if ($text === '') {
        fail('Comment is empty.');
    }
    $ip = client_hash();
    $recent = db()->prepare('SELECT COUNT(*) FROM map_comments WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL 1 HOUR)');
    $recent->execute([$ip]);
    if ((int)$recent->fetchColumn() >= config()['comments_per_hour']) {
        fail('Too many comments, please slow down.', 429);
    }
    $author = clean_text($body['author'] ?? '', 60, 'Anonymous');
    db()->prepare('INSERT INTO map_comments (map_id, author, body, ip_hash) VALUES (?, ?, ?, ?)')
        ->execute([$row['id'], $author, $text, $ip]);
    json_out(['ok' => true, 'comment' => [
        'id' => (int)db()->lastInsertId(), 'author' => $author, 'body' => $text, 'created_at' => date('Y-m-d H:i:s'),
    ]], 201);
}

function action_presets(): void
{
    $st = db()->query('SELECT name, color, style, uses FROM line_presets ORDER BY uses DESC, created_at DESC LIMIT 60');
    json_out(['ok' => true, 'presets' => $st->fetchAll()]);
}

function action_save_preset(): void
{
    $body = read_json_body();
    $name = clean_text($body['name'] ?? '', 60);
    $color = strtoupper((string)($body['color'] ?? ''));
    $style = (string)($body['style'] ?? 'solid');
    if ($name === '' || !preg_match('/^#[0-9A-F]{6}$/', $color) || !in_array($style, ['solid', 'double', 'dashed', 'dotted'], true)) {
        fail('Invalid line preset.');
    }
    db()->prepare('INSERT INTO line_presets (name, color, style) VALUES (?, ?, ?)
                   ON DUPLICATE KEY UPDATE uses = uses + 1')->execute([$name, $color, $style]);
    json_out(['ok' => true]);
}
