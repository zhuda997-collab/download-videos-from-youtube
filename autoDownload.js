//1.解除引用 var a ,  a = null
//2.闭包?
//3.console.log, 去掉;
//4.禁用大数值的全局变量;
//页面刷新多少次之后, 关旧页面,打开新页面;
//downloader有两个值ytd/downie
var downloader = 'downie';
//sysType  MAC/WIN
var sysType = 'MAC';

//多少秒之后重新加载页面?
const reloadSecond = 45;
//页面刷新多少次之后, 删除当前的tab页,打开新的
const refreshNum = 60;
const youtubeUrl = 'https://www.youtube.com/feed/subscriptions';
const retryHours = 0.15;
var destination = '';
var num = 10;
var folderPort = '';

$(function () {
    checkOs();
    if (checkGoogleSorry()) return;
    if (checkState()) return;
    if (checkUrl()) return;
    receiveMsgFromBgd();
    createDownloadButton();
    appendMsgOnLogo('端口:' + window.localStorage.getItem('folderPort'));
    recordTimes();
    // createTestButton()
    // (2026-06-15 09:46) 改为事件 callback 链 (取代 setTimeout 30s → click())
    //
    // 背景: setTimeout 30s 后调 $('#decollator').click() 是程序 click()
    //       event.isTrusted=false → user gesture 丢失
    //       → downLoadVideo 兜底 window.open(downie://) 被弹窗拦截器吞掉
    //
    // 新设计:
    //   - receiveMsgFromBgd 一拉到 config → 触发 'bgConfigReady' 事件
    //   - 监听 bgConfigReady 事件 → 立即调 downLoadAll('auto-config')
    //   - 30s 兜底: 如果 config 还没拉到, 30s 后调 downLoadAll('auto-timeout')
    //     (仍是程序触发, user gesture 丢失, 但主路径 sendMessage→sw 不依赖 gesture)
    //   - 用户主动 click button → downLoadAll('user-click') (user gesture 在手)
    var autoDownloadTriggered = false;
    var downLoadAll = async function (trigger) {
        if (autoDownloadTriggered) return;
        autoDownloadTriggered = true;
        console.log('[autoDownload] trigger=' + trigger + ' 开始下载');
        if (checkUrl()) return;
        if (!destination || !folderPort) {
            console.warn('[autoDownload] destination/folderPort 还没就绪, trigger=' + trigger
                + ' 跳过 (等下次)');
            autoDownloadTriggered = false;  // 允许重试
            return;
        }
        await loopVideos(trigger);
        beforeReload();
        console.log(getLocalTime());
        await sleep(reloadSecond * 1000);
        window.location.reload();
    };
    // 暴露给 createDownloadButton 的 onclick 用
    window.__downLoadAll = downLoadAll;
    // 事件 callback 链 (取代 setTimeout → click)
    var onBgConfigReady = function () {
        console.log('[autoDownload] bgConfigReady 事件触发, trigger=auto-config');
        downLoadAll('auto-config');
    };
    window.addEventListener('bgConfigReady', onBgConfigReady);
    // 30s 兜底: config 还没拉到, 程序触发一次 (user gesture 丢失)
    setTimeout(function () {
        if (!bgConfigLoaded) {
            console.warn('[autoDownload] 30s 后 config 仍未就绪, 强制 trigger=auto-timeout '
                + '(非 user gesture, 兜底 window.open 会被拦截)');
            downLoadAll('auto-timeout');
        }
        // 否则事件链已经触发过了, 啥都不做
    }, 30 * 1000);
    listenPopup();
});


var bgConfigLoaded = false;  // 推荐 C 修复 (2026-06-14): 标记 background config 是否已同步
var receiveMsgFromBgd = function () {
    chrome.runtime.sendMessage({action: 'getSharedData'}, function (response) {
        if (chrome.runtime.lastError) {
            console.error('[autoDownload] getSharedData failed:', chrome.runtime.lastError.message);
            return;
        }
        console.log("getSharedData:", response && response.destination, response && response.num);
        if (response) {
            updateDatasFromBg(response.destination, response.num, response.folderPort);
            if (!bgConfigLoaded) {
                bgConfigLoaded = true;
                // (2026-06-15 09:46) 事件 callback 链: config 拉到后立刻触发 'bgConfigReady'
                window.dispatchEvent(new Event('bgConfigReady'));
            }
        }
    });
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if (request.action === "updateDestination") {
            console.log("updateDestination:", request.sharedData.destination, request.sharedData.num);
            updateDatasFromBg(request.sharedData.destination, request.sharedData.num, request.folderPort);
            if (!bgConfigLoaded) {
                bgConfigLoaded = true;
                window.dispatchEvent(new Event('bgConfigReady'));
            }
        }
    });
};
var updateDatasFromBg = function (destination1, num1, folderPort1) {
    destination = destination1;
    num = num1;
    folderPort = folderPort1;
    window.localStorage.setItem('destination', destination1);
    window.localStorage.setItem('num', num1);
    window.localStorage.setItem('folderPort', folderPort1);
};
var createDownloadButton = function () {
    var decollator = document.createElement("button");
    decollator.id = "decollator";
    decollator.style.color = "black";
    $('#logo')[0].appendChild(decollator);
    decollator.innerHTML = '下载';
    decollator.onclick = function () {
        // (2026-06-15 09:46) 用户主动 click → user gesture 在手
        //   走 downLoadAll('user-click') → downLoadVideo 兜底 window.open 可用
        //   不用 async + await sleep 是为了保持 user gesture 同步链
        //   (Chrome 90+ 的 transient activation 在 await 后会丢失)
        if (window.__downLoadAll) {
            window.__downLoadAll('user-click');
        } else {
            console.error('[autoDownload] window.__downLoadAll 未就绪 (脚本初始化未完成)');
        }
    };
};

var checkDom = function () {
    return document.querySelectorAll('h3 a').length === 0;
};

var checkOs = function () {
    var os = navigator.platform;
    if (os.startsWith('Mac')) {
        downloader = 'downie';
        sysType = 'MAC';
        console.log('checkos', downloader, sysType);
    } else if (os.startsWith('Win')) {
        downloader = 'ytd';
        sysType = 'WIN';
        console.log('checkos', downloader, sysType);
    }
};
var checkGoogleSorry = function () {
    var url = window.location.href;
    if (url.indexOf('https://www.google.com/sorry/index?continue=') === 0) {
        window.open(youtubeUrl, '_blank');
        window.close();
        return true;
    }
};
/**
 * 页面刷新多少次之后, 删除 tbe, 打开新页签
 * @returns {boolean}
 */
var checkState = function () {
    var times1 = window.localStorage.getItem('times1');
    times1 = parseInt(times1);
    //每刷新 refreshNum 次, 打开新标签页, 关闭旧标签页
    if (times1 % refreshNum == 0) {
        times1 = times1 + 1
        window.localStorage.setItem('times1', times1);
        window.open(youtubeUrl, '_blank');
        window.close();
        return true;
    }
    return false;
};

/**
 * 如果不是YouTube订阅页面,则打开
 * @returns {boolean}
 */
var checkUrl = function () {
    var url = window.location.href;
    if (!url.startsWith(youtubeUrl)) {
        window.open(youtubeUrl, '_self');
        return true;
    }
};
var checkBrowser = function () {
    if (!!(navigator.brave || navigator.language === 'zh-CN')) {
        //brave 浏览器 或者 viva
        return true;
    }
};
var checkTime = function () {
    var theHour = new Date().getHours();
    //在早 [6, 21) 点时, 禁止 brave / viva 使用
    if ((theHour >= 6 && theHour < 21)) {
        return true;
    }
};

//获取当前时间
var getLocalTime = function () {
    var d = new Date();
    return d.toLocaleString();
}
//重新加载页面之前, 删除之前已经下载过的视频的信息
var beforeReload = function () {
    // 清除 localStorage 中多余的数据
    try {
        let elements = document.querySelectorAll('h3 a');
        for (let i = num + 10; i < num + 20; i++) {
            // 判断元素是否存在
            if (!elements[i]) continue;
            let a = elements[i];
            // 获取并补全 href
            let href = a.href || a.getAttribute("href");  // 推荐 B 修复 (2026-06-14): .href 返回绝对 URL，回退 getAttribute 防 undefined
            if (href && !href.startsWith('http')) {
                href = "https://www.youtube.com" + href;
            }
            href = normalizeYouTubeHref(href);
            // let hrefArr = href.split('&t=');
            window.localStorage.removeItem(href);
            // 记录日志
            console.log(i + ' 0');
        }
    } catch (error) {
        console.info(error);
    }
};

/**
 * 记录页面被刷新了多少次
 * @returns {number}
 */
var recordTimes = function () {
    var times1 = window.localStorage.getItem('times1');
    if (times1 === undefined || times1 === '' || times1 === null || times1 === 'null' || times1 === 'NaN') {
        times1 = 0;
    }
    appendMsgOnLogo('刷次:' + times1);
    times1 = parseInt(times1);
    times1++;
    window.localStorage.setItem('times1', times1);
};
var appendMsgOnLogo = function (msg) {
    var elemtnt = document.createElement("p");
    elemtnt.id = "elemtnt" + msg;
    elemtnt.style.color = "#FF000E";
    elemtnt.style.width = '500px';
    $('#logo')[0].appendChild(elemtnt);
    elemtnt.innerHTML = msg;
    elemtnt = null
};
/**
 * 循环视频列表, 检查是否已经被下载
 * (2026-06-15) 改成 async, 每个视频间 sleep 1.2s 给 Downie 协议注册留时间
 */
var loopVideos = async function (trigger) {
    console.info("destination:" + destination);
    console.info("num:" + num);
    console.info("trigger:" + trigger);
    let elements = document.querySelectorAll('h3 a');
    for (let i = 0; i < num; i++) {
        let a = elements[i];
        if (!a) continue;  // 推荐 A 修复 (2026-06-14): 防御 elements[i] undefined（页面 DOM 数量 < num 时跳过）
        // 拼接完整的 href
        let href = a.href || a.getAttribute("href");  // 推荐 B 修复 (2026-06-14): .href 返回绝对 URL，回退 getAttribute 防 undefined
        if (href && !href.startsWith('http')) {
            href = "https://www.youtube.com" + href;
        }
        href = normalizeYouTubeHref(href);
        // 获取视频标题: 优先 .title 属性（YouTube 总是会设置），回退 .innerText (修复 h3 a 没有内嵌 span 的情况)
        let name = a.getAttribute('title') || a.innerText || a.textContent || "";
        // (2026-06-15 09:46) 把 trigger 透传给 downLoadVideo, 用于 user gesture 决策
        await downLoadVideo(href, name, i, trigger);
        // 关键: 每次创建 tab 之间间隔 1.2s, 给 Downie 协议注册留时间
        // Chrome MV3 service worker 对 chrome.tabs.create 有 1s 限速, 多留 200ms 余量
        await sleep(1200);
    }
};
function normalizeYouTubeHref(href) {
    if (!href) return "";
    try {
        // 确保 href 是完整 URL
        if (!href.startsWith('http')) {
            href = "https://www.youtube.com" + href;
        }
        let url = new URL(href);
        // 只取 v 参数值
        let vid = url.searchParams.get('v');
        if (vid) {
            return `https://www.youtube.com/watch?v=${vid}`;
        }
        // 适配 /watch?t=Xs&v=yyy 这种参数顺序不一的情况
        // 或者 v 在 hash 部分，可自行处理
        return href;
    } catch (e) {
        return href; // 地址非法时返回原始
    }
}

var loopShortVideos = function () {
    var i;
    for (i = 1; i <= num; i++) {
        sleep(1);
        try {
            var thumb = document.querySelectorAll('#thumbnail')[i] || document.querySelectorAll('h3 a')[i];
        var href = thumb ? thumb.href : '';
            var hrefArr = href.split('&t=');
            downLoadVideo(hrefArr[0], name, i);
        } catch (error) {
            console.info('dom loading......')
            return;
        }

    }
};

/**
 * 下载视频
 * @param url youtube视频路径
 * @param name 视频名字
 * (2026-06-15) 改成 async, 不再用 window.open 触发 downie://
 * 原因: 连续 window.open 会被 Chrome MV3 限速, 后面 9 个都变成空白 tab
 * 修复: 走 chrome.runtime.sendMessage -> background.js 的 chrome.tabs.create
 *       每次创建之间 sleep 1.2s (在 loopVideos 里控制)
 */
var downLoadVideo = async function (url, name, i, trigger) {
    // 处理url，去除pp参数
    try {
        let urlObj = new URL(url);
        urlObj.searchParams.delete('pp');  // 删除pp参数
        url = urlObj.toString();
    } catch (e) {
        console.error('URL解析失败:', e);
        // 如果URL解析失败，保持原url不变
    }
    if (window.localStorage.getItem(url) !== null) {
        //已经下载过了
        // (2026-06-15) 改 !== null, 原 if (getItem(url)) 在 value=0 时会 false, 重复下载
        console.log(i + ' 1');
        return;
    }
    if (downloader === 'downie') {
        var downieUrl = "downie://XUOpenLink?url=" + encodeURI(url);
        downieUrl = downieUrl.replaceAll("&", "%26");
        downieUrl = downieUrl.replaceAll("#", "%23");
        downieUrl += '&destination=' + destination;

        // (2026-06-15 09:46) 双保险触发 downie (回滚 8b07e2d 的 content script 改动):
        //
        // 方案 1 (主): chrome.runtime.sendMessage → sw openDownieUrl → chrome.tabs.create
        //   ✅ 不依赖 user gesture (sw 里 tabs.create 是后台调)
        //   ✅ MV3 sw 限速可控 (handler 内 sleep 1.2s)
        //   ⚠️ 风险: 老 sw 可能没 openDownieUrl handler → "unknown action"
        //
        // 方案 2 (兜底): 3 次 sendMessage 失败 → chrome.tabs.create (content script 上下文)
        //   ✅ 主路径全挂 (sw 死了 / Chrome 没热重载) 还能跑
        //   ✅ chrome.tabs.create 是扩展 privileged API, Edge 视为"扩展派发"不弹协议落地页
        //   ✅ 不需要 user gesture, 所有 trigger 都跑
        //
        // 双保险触发逻辑 (主路径 sw 派发, 兜底 cs 派发):
        // | trigger      | 主路径 sendMessage  | 兜底 chrome.tabs.create |
        // |--------------|---------------------|--------------------------|
        // | user-click   | ✅ 3 次重试         | ✅ 主全挂时跑            |
        // | auto-config  | ✅ 3 次重试         | ✅ 主全挂时跑            |
        // | auto-timeout | ✅ 3 次重试         | ✅ 主全挂时跑            |
        //
        // 结论: 主路径永远跑; 兜底仅在主全挂时跑 (跟 user gesture 无关)

        // 方案 1: 3 次 sendMessage 重试
        let sendSuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const resp = await Promise.race([
                    chrome.runtime.sendMessage({
                        action: 'openDownieUrl',
                        url: downieUrl,
                        index: i
                    }),
                    new Promise((_, reject) => setTimeout(
                        () => reject(new Error('sendMessage timeout 5s')), 5000))
                ]);
                if (resp && resp.success) {
                    console.log(i + ' ' + name + ' (sendMessage 成功 attempt=' + attempt + ')');
                    sendSuccess = true;
                    break;
                }
                console.warn(i + ' ' + name + ' sendMessage 返回失败 attempt=' + attempt + ':',
                    resp && resp.error);
            } catch (e) {
                console.warn(i + ' ' + name + ' sendMessage 异常 attempt=' + attempt + ':',
                    e && e.message);
            }
            if (attempt < 3) await sleep(800);  // 重试 backoff
        }

        // 方案 2 (E5-C 改造 2026-06-16): 兜底走 9090 /api/downie/download
        //
        // 历史: 兜底一直是 chrome.tabs.create({url: downieUrl}), 但 downie://XUOpenLink 是
        //   Chromium External Protocol, 即使从扩展触发也会弹 External Protocol Dialog
        //   (Chromium 内部 dialog, 不是 macOS 弹窗). 改 macOS LaunchServices (E1) /
        //   QQBrowser user prefs policy (E6) 都无效.
        //
        // 修法 (E5-A + E5-C, 2026-06-16):
        //   - 9090 新加 GET /api/downie/download?url=...&dest=... 端点
        //   - 端点内部调 osascript 'open location downie://XUOpenLink?...'
        //   - osascript 走 macOS LaunchServices, **完全不经 Chrome 协议栈**, 不弹 dialog
        //   - 验证: osascript 'open location' 真的让 Downie 4 开始下载 (实测 2026-06-16 01:22)
        //
        // fetch 失败兜底:
        //   - 9090 没起: fetch reject → 等会儿再试 chrome.tabs.create (原行为)
        //   - 9090 起来但 osascript 失败: response.success=false → 等会儿再试 chrome.tabs.create
        //
        // CORS: 9090 DownieDownloadController 已加 @CrossOrigin for youtube.com / chrome-extension://*
        if (!sendSuccess) {
            console.warn(i + ' ' + name + ' 3 次 sendMessage 失败, '
                + '走 E5-C 兜底 fetch 9090 /api/downie/download (trigger=' + trigger + ')');
            // 提取原始 YouTube URL 和 destination (构造 fetch URL)
            // downieUrl 形如: downie://XUOpenLink?url=...&destination=...
            // fetch endpoint 接收 url (youtube url) 和 dest (本地目录), 不接收 downie:// URL
            try {
                // 从 downieUrl 拆出原始 url 和 destination
                // downieUrl 里的 url/destination 都是 encodeURI 风格, 需要再 decode 一次给 fetch
                let m = downieUrl.match(/url=([^&]+)&destination=(.+)$/);
                if (!m) {
                    throw new Error('downieUrl 解析失败: ' + downieUrl.substring(0, 100));
                }
                let originalUrl = decodeURIComponent(m[1]);
                let originalDest = decodeURIComponent(m[2]);
                let fetchUrl = 'http://localhost:9090/api/downie/download'
                    + '?url=' + encodeURIComponent(originalUrl)
                    + '&dest=' + encodeURIComponent(originalDest);

                // fetch (3s 超时, osascript 一般秒返回)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                let resp;
                try {
                    resp = await fetch(fetchUrl, {signal: controller.signal});
                } finally {
                    clearTimeout(timeoutId);
                }
                if (resp.ok) {
                    const data = await resp.json();
                    if (data && data.success) {
                        console.log(i + ' ' + name
                            + ' (E5-C fetch 9090 成功, downieUrl='
                            + (data.downieUrl ? data.downieUrl.substring(0, 80) : '?') + '...)');
                    } else {
                        console.error(i + ' ' + name
                            + ' E5-C fetch 9090 但 downie 失败:',
                            data && data.error);
                    }
                } else {
                    console.error(i + ' ' + name
                        + ' E5-C fetch 9090 HTTP ' + resp.status);
                }
            } catch (e) {
                // fetch reject (9090 没起 / 网络错 / AbortError 超时)
                console.error(i + ' ' + name
                    + ' E5-C fetch 9090 异常:',
                    e && e.message);
                // 最后兜底: chrome.tabs.create (原行为, 期望有 user gesture)
                // 但如果是 auto-config / auto-timeout, 这里也会弹 dialog
                // 所以只是尽力, 不指望
                if (trigger === 'user-click') {
                    console.warn(i + ' ' + name
                        + ' E5-C fetch 失败, user-click 走最后兜底 chrome.tabs.create');
                    try {
                        await chrome.tabs.create({url: downieUrl, active: false});
                    } catch (e2) {
                        console.error(i + ' ' + name + ' 最终兜底也失败:', e2 && e2.message);
                    }
                }
            }
        }
    } else if (downloader === 'ytd') {
        var ytdUrl = 'ytd://' + (url).replace(/https?:\/\//i, '');
        document.location.href = ytdUrl;
        //to get video cover
        try {
            saveCover(url, name, destination, sysType);
        } catch (e) {
            console.error(e.getError());
        }
    } else {
        console.error('downloader 没有配置');
    }
    var value = window.localStorage.getItem('times1')
    if (value === null || value === 'null') {
        value = 0;
    }
    window.localStorage.setItem(url, value);
};

/**
 *  睡眠函数 (异步版) - 2026-06-15 重构
 *  原来是个死循环 (while true {}), 会独占主线程 1-10 秒, 导致 Downie 协议注册不上
 *  改成 setTimeout Promise, 主线程可以处理 chrome.tabs.create / 协议回调
 *  @param numberMillis -- 要睡眠的毫秒数
 */
function sleep(numberMillis) {
    return new Promise(resolve => setTimeout(resolve, numberMillis));
}

var saveCover = function (videoUrl, name, path, sysType) {
    // Base URL of your Java backend
    const baseUrl = "http://localhost:9090";
    // Endpoint for the saveCoverByUrlAndName method
    const endpoint = "/api/saveCover";
    // Encode parameters
    const encodedVideoUrl = encodeURIComponent(videoUrl);
    const encodedName = encodeURIComponent(name);
    const encodedPath = encodeURIComponent(path);
    const encodedSysType = encodeURIComponent(sysType);

    // Construct the full URL
    const url = `${baseUrl}${endpoint}?videoUrl=${encodedVideoUrl}&name=${encodedName}&path=${encodedPath}&sysType=${encodedSysType}`;
    // Make a GET request
    fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            // Add any additional headers if required
        },
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.text();
        })
        .then(data => {
            console.log(data);
            // Handle the response data as needed
        })
        .catch(error => {
            console.error('Fetch error:', error);
            // Handle errors
        });
}

var createTestButton = function () {
    var buttonElement = document.createElement("button");
    buttonElement.id = "buttonElement";
    buttonElement.style.color = "black";
    $('#logo')[0].appendChild(buttonElement);
    buttonElement.innerHTML = 'TEST';
    buttonElement.onclick = function () {
        saveCover('https://www.youtube.com/watch?v=-FlNhtlpJ-U', 'test-cover', '/Users/2024m4/Downloads/9212', sysType);
    };
};
/**
 * 初始化变量, 已经废弃
 * 1.判断浏览器版本;
 * 2.不同的浏览器, 初始化不同的数值
 */
var initVar = function () {
    if (navigator.brave) {
        //brave
        console.log("brave");
    } else if (navigator.userAgent.indexOf("Edg") != -1) {
        // edge
        console.log("edge");
    } else if (navigator.userAgent.indexOf("OPR") != -1) {
        //Opera
        console.log("opera");
    } else if (navigator.userAgent.indexOf("QQBrowser") != -1) {
        //QQBrowser
        console.log("QQ");
    } else {
        if (navigator.language === 'en') {

        } else if (navigator.language === 'zh-CN') {

        } else if (navigator.language === 'ru') {
            //Yandex
            console.log("yandex");
        }
    }
};

var listenPopup = function () {
    // 监听来自 popup.js 的消息
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if (request.action === "clearTimes1") {
            clearTimes1();
        }
    });
};
var clearTimes1 = function () {
    window.localStorage.setItem('times1', '0');
};