<?php
// 1. 设置长效 Session (100年)
$lifetime = 3153600000; 
session_set_cookie_params([
    'lifetime' => $lifetime,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax'
]);
session_start();

// 2. 动态处理跨域
if (isset($_SERVER['HTTP_ORIGIN'])) {
    header("Access-Control-Allow-Origin: {$_SERVER['HTTP_ORIGIN']}");
    header("Access-Control-Allow-Credentials: true");
    header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, X-Requested-With");
}

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit; 
}

/**
 * 容量配置与计算
 */
$config_file = 'config.json';
$exts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
$config = file_exists($config_file) ? json_decode(file_get_contents($config_file), true) : ['max_mb' => 100];

function get_used_space($exts) {
    $size = 0;
    foreach (scandir('.') as $file) {
        if (in_array(strtolower(pathinfo($file, PATHINFO_EXTENSION)), $exts)) {
            $size += filesize($file);
        }
    }
    return $size;
}

$used_bytes = get_used_space($exts);
$max_bytes = $config['max_mb'] * 1024 * 1024;
$remaining_mb = round(($max_bytes - $used_bytes) / 1024 / 1024, 2);

/**
 * 身份校验 (支持 API 传参)
 * 默认密码123，它的sha265是'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3'
 * 改成别的就用sha265工具转换一下在复制到$safe_key = ''
 */
$safe_key = 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3'; 
$is_api = (isset($_REQUEST['api']) || (isset($_SERVER['HTTP_X_REQUESTED_WITH']) && $_SERVER['HTTP_X_REQUESTED_WITH'] == 'XMLHttpRequest'));

// 如果带了 mypass 参数，尝试进行静默登录
if (isset($_REQUEST['mypass'])) {
    if (hash('sha256', trim($_REQUEST['mypass'])) === $safe_key) {
        $_SESSION['auth'] = 'YES';
    }
}

// --- 权限拦截 ---
if (!isset($_SESSION['auth']) || $_SESSION['auth'] !== 'YES'):
    if ($is_api):
        header('Content-Type: application/json');
        die(json_encode(["status" => "error", "message" => "未授权"]));
    endif;
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>身份验证</title>
    <style>
        body { background: #f5f7f9; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; margin: 0; }
        .login { background: #fff; padding: 40px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); width: 300px; text-align: center; }
        input[type="password"] { width: 100%; padding: 12px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; text-align:center; font-size: 16px; outline: none; }
        input[type="submit"] { width: 100%; padding: 12px; background: #2c3e50; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
        .err { color: #e74c3c; font-size: 13px; margin-bottom: 15px; border: 1px solid #ffa39e; background: #fff1f0; padding: 5px; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="login">
        <h2 style="margin-top:0; color:#2c3e50; font-weight: 500;">管理登录</h2>
        <form method="POST">
            <input type="password" name="mypass" placeholder="请输入密钥" required autofocus>
            <?php if(isset($_POST['mypass'])) echo "<div class='err'>口令错误</div>"; ?>
            <input type="submit" value="确认">
        </form>
    </div>
</body>
</html>
<?php
    exit;
endif;

// --- 管理后台逻辑 ---

// 1. 设置容量
if (isset($_POST['set_max'])) {
    $new_max = (float)$_POST['max_mb'];
    if ($new_max > 0) {
        $config['max_mb'] = $new_max;
        file_put_contents($config_file, json_encode($config));
        header("Location: index.php");
        exit;
    }
}

// 2. 状态 API (插件专用)
if (isset($_GET['status']) && $is_api) {
    header('Content-Type: application/json');
    die(json_encode(["status" => "success", "remaining" => $remaining_mb]));
}

// 3. 上传逻辑
$m = "";
if (isset($_POST['up']) && isset($_FILES['f'])) {
    $file_size = $_FILES['f']['size'];
    if (($used_bytes + $file_size) > $max_bytes) {
        if ($is_api) {
            header('Content-Type: application/json');
            die(json_encode(["status" => "error", "message" => "容量不足"]));
        }
        $m = "错误：超出空间限额";
    } else {
        $original_fn = basename($_FILES["f"]["name"]);
        $ex = strtolower(pathinfo($original_fn, PATHINFO_EXTENSION));
        if (in_array($ex, $exts)) {
            $fn = $original_fn;
            $count = 1;
            while (file_exists("./" . $fn)) {
                $fn = pathinfo($original_fn, PATHINFO_FILENAME) . "_" . $count . "." . $ex;
                $count++;
            }
            if (move_uploaded_file($_FILES["f"]["tmp_name"], "./" . $fn)) {
                $protocol = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http");
                $dynamic_url = $protocol . "://" . $_SERVER['HTTP_HOST'] . rtrim(dirname($_SERVER['PHP_SELF']), '/\\') . "/" . $fn;
                
                $new_rem = round(($max_bytes - get_used_space($exts)) / 1024 / 1024, 2);
                if ($is_api) {
                    header('Content-Type: application/json');
                    die(json_encode(["status" => "success", "url" => $dynamic_url, "remaining" => $new_rem]));
                }
                $m = "上传成功";
                $remaining_mb = $new_rem;
            }
        }
    }
}

// 4. 删除逻辑
if (isset($_GET['del'])) {
    $f = $_GET['del'];
    if (file_exists($f) && !str_contains($f, '/') && !str_contains($f, '\\')) {
        unlink($f); 
        header("Location: index.php"); 
        exit;
    }
}

// 5. 获取列表
$imgs = array_filter(scandir('.'), function($f) use ($exts) {
    return in_array(strtolower(pathinfo($f, PATHINFO_EXTENSION)), $exts);
});
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>图片控制中心</title>
    <style>
        body { font-family: sans-serif; background: #f0f2f5; padding: 20px; margin: 0; }
        .nav { background: #fff; padding: 15px 25px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
        .card { background: #fff; border-radius: 8px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .card img { width: 100%; height: 160px; object-fit: contain; background: #f8f9fa; border-radius: 4px; }
        .box { width: 100%; margin: 10px 0; padding: 8px; font-size: 11px; border: 1px solid #eee; border-radius: 4px; box-sizing: border-box; background: #fafafa; }
        .btn { padding: 6px 12px; border-radius: 4px; cursor: pointer; border: none; font-size: 12px; color:#fff; text-decoration:none; display: inline-block; }
        .cap-bar { background: #fff; padding: 15px; border-radius: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    </style>
</head>
<body>
<div class="nav">
    <strong>MY GALLERY</strong>
    <a href="?out=1" style="color:#666; font-size:13px; text-decoration:none;">退出登录</a>
</div>

<div class="cap-bar">
    <div>剩余：<strong style="color:#27ae60"><?php echo $remaining_mb; ?> MB</strong> / <?php echo $config['max_mb']; ?> MB</div>
    <form method="POST"><input type="number" name="max_mb" step="0.1" placeholder="指定最大容量MB" required style="width:80px; padding:4px;"> <input type="submit" name="set_max" value="设置"></form>
</div>

<div style="background:#fff; padding:20px; border-radius:8px; margin-bottom:20px;">
    <form method="post" enctype="multipart/form-data">
        <input type="file" name="f" required>
        <input type="submit" name="up" value="上传" style="background:#2c3e50; color:#fff; border:none; padding:6px 20px; border-radius:4px; cursor:pointer;">
    </form>
</div>

<div class="grid">
    <?php foreach ($imgs as $i): 
        $u = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://" . $_SERVER['HTTP_HOST'] . rtrim(dirname($_SERVER['PHP_SELF']), '/\\') . "/" . $i; 
    ?>
    <div class="card">
        <a href="<?php echo $i; ?>" target="_blank"><img src="<?php echo $i; ?>"></a>
        <input type="text" class="box" id="c<?php echo md5($i); ?>" value="<?php echo $u; ?>" readonly>
        <button class="btn" style="background:#27ae60" onclick="copy('c<?php echo md5($i); ?>')">复制</button>
        <a href="?del=<?php echo urlencode($i); ?>" class="btn" style="background:#e74c3c; float:right" onclick="return confirm('删除？')">删除</a>
    </div>
    <?php endforeach; ?>
</div>

<script>
function copy(id) {
    const e = document.getElementById(id); e.select(); document.execCommand('copy'); alert('已复制');
}
</script>
</body>
</html>
