function loadScreen() {
    setTimeout(function() {
    document.getElementById("loading").style.display = "none";
    }, 4000);
}
loadScreen();

function copyUrl() {
    let x = document.getElementById("share").innerHTML;
    let a = window.location.href;
    let b = "Hey, I am sharing you an awesome website to you!! Visit: ";
    let c = b + a;
    navigator.clipboard.writeText(c);
    document.getElementById("share").innerHTML = "Copied!";
    var delayInMilliseconds = 2000; //1 second

    setTimeout(function() {
        document.getElementById("share").innerHTML = x;
    }, delayInMilliseconds);
};