import { useEffect } from "react";
import * as anime from "animejs";

const AnimeAnimation = () => {
  useEffect(() => {
    // Animate logo
    anime.set(".auth-logo", { opacity: 0, scale: 0.8 });
    anime({
      targets: ".auth-logo",
      opacity: 1,
      scale: 1,
      duration: 800,
      easing: "easeOutElastic(1, .6)",
      delay: 100,
    });

    // Animate heading
    anime.set(".auth-heading", { opacity: 0, translateY: -20 });
    anime({
      targets: ".auth-heading",
      opacity: 1,
      translateY: 0,
      duration: 600,
      easing: "easeOutQuad",
      delay: 300,
    });

    // Animate subtitle
    anime.set(".auth-subtitle", { opacity: 0, translateY: -10 });
    anime({
      targets: ".auth-subtitle",
      opacity: 1,
      translateY: 0,
      duration: 600,
      easing: "easeOutQuad",
      delay: 400,
    });

    // Animate form card
    anime.set(".auth-form-card", { opacity: 0, translateY: 20, scale: 0.95 });
    anime({
      targets: ".auth-form-card",
      opacity: 1,
      translateY: 0,
      scale: 1,
      duration: 700,
      easing: "easeOutQuad",
      delay: 500,
    });

    // Animate form inputs
    anime.set(".auth-input", { opacity: 0, translateX: -20 });
    anime({
      targets: ".auth-input",
      opacity: 1,
      translateX: 0,
      duration: 600,
      easing: "easeOutQuad",
      delay: anime.stagger(100, { start: 700 }),
    });

    // Animate submit button
    anime.set(".auth-button", { opacity: 0, scale: 0.9 });
    anime({
      targets: ".auth-button",
      opacity: 1,
      scale: 1,
      duration: 600,
      easing: "easeOutQuad",
      delay: 1000,
    });

    // Animate footer text
    anime.set(".auth-footer", { opacity: 0 });
    anime({
      targets: ".auth-footer",
      opacity: 1,
      duration: 600,
      easing: "easeOutQuad",
      delay: 1100,
    });

    // Animate BIM image
    anime.set(".auth-bim-image", { opacity: 0, scale: 0.9, rotate: -5 });
    anime({
      targets: ".auth-bim-image",
      opacity: 1,
      scale: 1,
      rotate: 0,
      duration: 900,
      easing: "easeOutQuad",
      delay: 600,
    });

    // Continuous subtle animation on BIM image
    anime({
      targets: ".auth-bim-image",
      translateY: [0, -10, 0],
      duration: 4000,
      easing: "easeInOutSine",
      loop: true,
    });

    // Animate logo on hover
    const logoElement = document.querySelector(".auth-logo");
    if (logoElement) {
      logoElement.addEventListener("mouseenter", () => {
        anime({
          targets: ".auth-logo",
          scale: 1.1,
          duration: 400,
          easing: "easeOutQuad",
        });
      });

      logoElement.addEventListener("mouseleave", () => {
        anime({
          targets: ".auth-logo",
          scale: 1,
          duration: 400,
          easing: "easeOutQuad",
        });
      });
    }

    // Animate input focus
    const inputs = document.querySelectorAll(".auth-input input, .auth-input textarea");
    inputs.forEach((input) => {
      input.addEventListener("focus", () => {
        anime({
          targets: input.parentElement,
          scale: 1.02,
          duration: 300,
          easing: "easeOutQuad",
        });
      });

      input.addEventListener("blur", () => {
        anime({
          targets: input.parentElement,
          scale: 1,
          duration: 300,
          easing: "easeOutQuad",
        });
      });
    });

    // Button hover effect
    const buttons = document.querySelectorAll(".auth-button button");
    buttons.forEach((button) => {
      button.addEventListener("mouseenter", () => {
        anime({
          targets: button,
          scale: 1.02,
          duration: 300,
          easing: "easeOutQuad",
        });
      });

      button.addEventListener("mouseleave", () => {
        anime({
          targets: button,
          scale: 1,
          duration: 300,
          easing: "easeOutQuad",
        });
      });
    });
  }, []);

  return null;
};

export default AnimeAnimation;
