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
    //这里使用 setTimeout, 等待30秒, 为了让 dom 能完成加载之后, 再执行下载任务
    var timeOut2 = setTimeout(function () {
        clearTimeout(timeOut2);
        if (!bgConfigLoaded) {
            console.warn('[autoDownload] 30s 后 background config 还没拉回来，延迟到 60s 再 click');
            var timeOut3 = setTimeout(function() {
                clearTimeout(timeOut3);
                $('#decollator').click();
            }, 30000);
            return;
        }
        $('#decollator').click();
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
            bgConfigLoaded = true;
        }
    });
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if (request.action === "updateDestination") {
            console.log("updateDestination:", request.sharedData.destination, request.sharedData.num);
            updateDatasFromBg(request.sharedData.destination, request.sharedData.num, request.sharedData.folderPort);
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
    decollator.onclick = async function () {
        if (checkUrl()) return;
        if (!destination || !folderPort) {
            console.warn('[autoDownload] destination/folderPort 还没从 background 拉回来，等 5s 再试...');
            await sleep(5000);
            if (destination && folderPort) {
                await loopVideos();
                beforeReload();
            } else {
                console.error('[autoDownload] 5s 后 destination 仍为空，放弃本次触发');
                return;
            }
            console.log(getLocalTime());
            await sleep(reloadSecond * 1000);
            window.location.reload();
            return;
        }
        await loopVideos();
        beforeReload();
        console.log(getLocalTime());
        // 异步 sleep, 不用 setTimeout 模拟, 避免独占主线程
        await sleep(reloadSecond * 1000);
        window.location.reload();
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
var loopVideos = async function () {
    console.info("destination:" + destination);
    console.info("num:" + num);
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
        await downLoadVideo(href, name, i);
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
var downLoadVideo = async function (url, name, i) {
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
        // (2026-06-15) 直接调 chrome.tabs.create, 不再走 service worker
        // 原因: service worker 不热重载, 用户的 Chrome 可能还是老版 background.js
        //       (没有 openDownieUrl handler), 导致 "unknown action: openDownieUrl" 报错
        // 修复: content_scripts 直接调 chrome.tabs.create (需要 manifest 里的 "tabs" 权限)
        //       限速靠 loopVideos 里的 await sleep(1200) 串行调
        try {
            await chrome.tabs.create({url: downieUrl, active: false});
            console.log(i + ' ' + name + ' (downie 创建 tab 成功)');
        } catch (e) {
            console.error(i + ' ' + name + ' chrome.tabs.create 失败:', e && e.message);
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