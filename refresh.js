//第一版
// 已经放弃的方法

//给a标签 加 href显示的方法
var reloadSecond = 10;
//倒计时显示的最大值
var t = 7;
var href1 = '';

var downloadVideo = function (url) {
    debugger;
    window.sessionStorage.setItem(url, 'url');
    var md5Str1 = $.md5(url);
    console.info('url:' + url);
    console.info('md5string:' + md5Str1);
    // debugger;
    if (!window.sessionStorage.getItem(md5Str1)) {
        console.info('url' + url);
        var action_url = "downie://XUOpenLink?url=" + encodeURI(url);
        action_url = action_url.replaceAll("&", "%26");
        action_url = action_url.replaceAll("#", "%23");
        console.info('action_url' + action_url);
        // alert(action_url);
        $('body').html('<h1>' + action_url + '</h1>');
        window.open(action_url, '_blank');
        // debugger;
        window.sessionStorage.setItem(md5Str1, 'md5');
    } else {
        $('body').html('<h1>视频已经被下载</h1>');
    }
}
var gotoSubscriptions = function () {
    clearInterval(interval1);
    clearTimeout(timeOut1);
    window.location.replace("https://www.youtube.com/feed/subscriptions");
}
var reloadPage = function () {
    clearInterval(interval1);
    clearTimeout(timeOut1);
    window.location.reload();
}
$(document).ready(function () {
    //从封面图中
    $("a").click(function () {
        href1 = $(this).attr("href");
        $(this).attr("href", "javascript:;");
        if (href1 === '' || href1 === null || href1 === undefined) {
            alert('下载链接 href1 is null');
        } else if (href1 === '/feed/subscriptions') {
            alert('进入订阅页面');
        } else if (href1 === "") {
        } else {
            href1 = 'https://www.youtube.com' + href1;
            downloadVideo(href1);
        }
        reloadPage();
    });
});
//点击视频
var timeOut1;
$(document).ready(function () {
    $("a").click(function () {
        return false;
    });
    timeOut1 = setTimeout(function () {
        // alert(document.querySelectorAll('#video-title-link')[0].href);
        //video-title-link
        var video = $("#video-title");
        if (video) {
            debugger;
            video.css("color", "red");
            video.click();
        } else {
            reloadPage();
        }
    }, reloadSecond * 1000)
});
//设置计时器
$(document).ready(function () {
    var time = document.createElement("h1");
    time.id = "time";//给父div设置class属性
    time.style.color = "red";
    time.style.width = '500px';
    $('#logo')[0].appendChild(time);
    var paragraph = document.createElement("h1");
    paragraph.id = "paragraph";//给父div设置class属性
    paragraph.style.color = "black";
    paragraph.innerHTML = '○';
    $('#logo')[0].appendChild(paragraph);
    var refreshTime = document.createElement("h1");
    refreshTime.id = "refreshTime";//给父div设置class属性
    refreshTime.style.color = "blue";
    refreshTime.style.width = '500px';
    $('#logo')[0].appendChild(refreshTime);

    var rt = window.sessionStorage.getItem('rt');
    refreshTime.innerHTML = rt;
    var timer = setInterval(function () {
        time.innerHTML = t;
        t--;
        if (t < 0) {
            if (!rt) {
                window.sessionStorage.setItem('rt', '0');
            } else {
                rt = parseInt(rt);
                rt++;
                window.sessionStorage.setItem('rt', rt);
            }
            clearInterval(timer);
        }
    }, 1000)
});
//判断当前页,是不是订阅页面,如果不是,跳转回去
var interval1;
$(document).ready(function () {
    interval1 = setInterval(function () {
        var url = window.location.href;
        if (url !== 'https://www.youtube.com/feed/subscriptions') {
            downloadVideo(url);
            gotoSubscriptions();
        }
    }, 1000)
});


/**
 *  睡眠函数
 *  @param numberMillis -- 要睡眠的秒数
 */
function sleep(numberMillis) {
    numberMillis = numberMillis * 1000;
    var now = new Date();
    var exitTime = now.getTime() + numberMillis;
    while (true) {
        now = new Date();
        if (now.getTime() > exitTime)
            return;
    }
}