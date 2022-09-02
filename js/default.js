const blocks = gsap.utils.toArray(".animate");
blocks.forEach(animate => {
  const anim = gsap.fromTo(animate,
    {
      autoAlpha: 0,
      y: -100,
      x: 100,
      rotate: 0
    },
    {
      duration: 0.6,
      autoAlpha: 1,
      y: 0,
      x: 0,
      rotate: 0
    });
    ScrollTrigger.create({
      trigger: animate,
      animation: anim,
    });
});

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