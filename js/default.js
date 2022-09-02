// function loadScreen() {
//     setTimeout(function() {
//     document.getElementById("loading").style.display = "none";
//     }, 4000);
//     let url = window.location.href;
//     if (navigator.share) {
//         navigator.share({
//           title: 'getprojects.tech',
//           text: 'Hey! check out GetProjects, it will help you in your projects. Also share it with your friends..',
//           url: url,
//         })
//           .then(() => console.log('Successful share'))
//           .catch((error) => console.log('Error sharing', error));
//       }
// }
// loadScreen();

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

function hamberger() {
    var x = document.getElementById("hambergerMenu");
    if (x.style.display === "flex") {
      x.style.display = "none";
    } else {
      x.style.display = "flex";
    }

    var a = document.getElementById("hambergerico").classList.value;
    if (a === "fa-solid fa-bars") {
        var element = document.getElementById("hambergerico");
        element.classList.toggle("fa-bars");
        element.classList.toggle("fa-xmark");
    } else {
        var element = document.getElementById("hambergerico");
        element.classList.toggle("fa-xmark");
        element.classList.toggle("fa-bars");
    }
  

  }