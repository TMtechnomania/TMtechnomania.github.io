$(document).ready(function(){
    $(function(){
        $("#bgcolor").load("https://getprojects.tech/components/bgcolor/index.html");
        $("#navbar").load("https://getprojects.tech/components/navbar/index.html");
        $("#footer").load("https://getprojects.tech/components/footer/index.html");
    });
});

function toggleMenu(){
    var a = document.getElementById("mobileMenu").classList.value;
    if (a === "fa-solid fa-bars") {
        var element = document.getElementById("mobileMenu");
        element.classList.toggle("fa-bars");
        element.classList.toggle("fa-xmark");
        $("#navmenu").animate({
            width: '200px'
        });
    } else {
        var element = document.getElementById("mobileMenu");
        element.classList.toggle("fa-xmark");
        element.classList.toggle("fa-bars");
        $("#navmenu").animate({
            width: '0'
        });
    }
}

function share() {
    let x = document.getElementsByClassName("share").innerHTML;
    let a = window.location.href;
    let b = "Hey, checkout this awesome website: ";
    let c = b + a;
    navigator.clipboard.writeText(c);
    document.getElementsByClassName("share").innerHTML = "Copied!";
    var delayInMilliseconds = 2000; //1 second

    setTimeout(function() {
        document.getElementsByClassName("share").innerHTML = x;
    }, delayInMilliseconds);
};

function search_pages(){
    let input = document.getElementById('search').value
    input=input.toLowerCase();
    let x = document.getElementsByClassName('href');

    for (i = 0; i < x.length; i++) { 
        if (!x[i].innerHTML.toLowerCase().includes(input)) {
            x[i].style.display="none";
        }
        else{
            x[i].style.display="flex";
            $('#searchbar ul').find('li:visible:first').css('background-color','var(--white-black)');
        }
    }
    
    let searchaction = document.getElementById('search');
    searchaction.addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            $('#searchbar').find('li a:visible:first').attr('id', 'clickit');
            document.getElementById("clickit").click();
        };
    });
    if (input === '') {
    $('#searchbar').find('li:visible').css('background-color','var(--bd-white-black)');
    $('#searchbar').find('li a:visible').removeAttr('id');
    }
    else{
        $('#searchbar').find('li:visible:first').css('background-color','var(--white-black)');
    }
}