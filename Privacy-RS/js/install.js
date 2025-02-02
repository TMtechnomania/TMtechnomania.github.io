$(document).ready(function() {
    const width = screen.innerWidth;
    const scale = width / 1920;
    $("body").css("--scale", scale);
    window.addEventListener("resize", function() {
        const width = window.innerWidth;
        const scale = width / 1920;
        $("body").css("--scale", scale);
    });

    const $agree = $("#agree");
    const $disagree = $("#disagree");
    const $clear = $("#clear");
    $agree.click(function() {
        $agree.addClass("selected");
        $agree.text("Agreed!");
        $disagree.removeClass("selected");
        $disagree.text("Disagree");
        $clear.show();
        chrome.storage.local.set({ userConsent: "true" }, function() {
            console.log("userConsent is set to true");
        });
    });
    $disagree.click(function() {
        $agree.removeClass("selected");
        $agree.text("Agree");
        $disagree.addClass("selected");
        $disagree.text("Disagreed!");
        $clear.show();
        chrome.storage.local.set({ userConsent: "false" }, function() {
            console.log("userConsent is set to false");
        });
    });
    $clear.click(function() {
        $agree.removeClass("selected");
        $agree.text("Agree");
        $disagree.removeClass("selected");
        $disagree.text("Disagree");
        $clear.hide();
        chrome.storage.local.set({ userConsent: "null" }, function() {
            console.log("userConsent is set to null");
        });
    });
    chrome.storage.local.get(["userConsent"], function(result) {
        console.log("Value currently is " + result.userConsent);
        if (result.userConsent == "true") {
            $agree.addClass("selected");
            $agree.text("Agreed!");
            $disagree.removeClass("selected");
            $clear.show();
        } else if (result.userConsent == "false") {
            $agree.removeClass("selected");
            $disagree.addClass("selected");
            $disagree.text("Disagreed!");
            $clear.show();
            alert("You must agree to the terms of service to use this extension.");
        }
    });
});