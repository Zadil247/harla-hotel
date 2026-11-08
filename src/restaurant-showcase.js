// Owner-supplied photographs. Keep descriptions factual; menu availability may vary.
export const restaurantPhotos = [
  ["img_1243", "A table full of possibilities", "A selection of Harla dishes and colourful dessert glasses"],
  ["img_1250", "Fresh from the oven", "A golden baked dish served in a black pan"],
  ["img_1256", "Sandwiches & sides", "Stacked sandwiches served with golden fries"],
  ["img_1266", "Ethiopian favourites", "Injera surrounding a richly coloured dish topped with an egg"],
  ["img_1270", "A golden start to the day", "Folded golden pancakes on a white plate"],
  ["img_1278", "Breakfast at Harla", "A freshly prepared omelette on a white plate"],
  ["img_1281", "Made for a slow morning", "Golden toast slices arranged on a plate"],
  ["img_20260507_125016_575", "Gather around the table", "A spread of dishes inside the Harla restaurant"],
  ["img_1239", "From the Harla kitchen", "A wide selection of dishes and dessert glasses"],
  ["img_1242", "Something for every appetite", "Restaurant dishes arranged together on the serving counter"],
  ["img_1245", "Ready to share", "A close view across the restaurant's selection of dishes"],
  ["img_1246", "A feast in view", "An upright view of the food display in the Harla kitchen"],
  ["img_1247", "Golden & oven-baked", "An overhead view of a baked dish in a round pan"],
  ["img_1253", "A lunch-time favourite", "Sandwiches and fries on a white serving plate"],
  ["img_1255", "Take a closer look", "A close view of the sandwich and fries plate"],
  ["img_1263", "A taste of tradition", "An overhead view of injera and a spiced dish with an egg"],
  ["img_1264", "Flavours worth lingering over", "A close view of the injera dish and egg"],
  ["img_1267", "Breakfast, beautifully served", "An overhead view of folded golden pancakes"],
  ["img_1272", "Good mornings begin here", "Golden pancakes arranged on a white plate"],
  ["img_1273", "Simple morning pleasures", "An overhead view of a golden omelette"],
].map(([file, title, alt]) => ({ src: `/assets/restaurant/showcase/${file}.webp`, title, alt }));

export function RestaurantShowcase() {
  const first = restaurantPhotos[0];
  return `
    <section class="section food-showcase" id="restaurant-showcase" aria-labelledby="food-showcase-title" data-food-showcase>
      <div class="food-showcase-layout">
        <div class="food-showcase-copy">
          <p class="eyebrow">At our table</p>
          <h2 id="food-showcase-title">A taste<br />of Harla.</h2>
          <p>From Ethiopian favourites to golden breakfasts and something sweet, take a look at what comes from our kitchen.</p>
          <a class="btn btn-primary" href="#restaurant-order-options">Explore the menu</a>
          <a class="food-vip-link" href="./restaurant-vip.html">Prefer a private table? Discover our VIP Majlis ↗</a>
        </div>
        <div class="food-showcase-player" role="region" aria-roledescription="carousel" aria-label="Harla restaurant photographs" tabindex="0">
          <div class="food-showcase-stage" data-food-stage>
            <img class="food-showcase-image is-active" src="${first.src}" alt="${first.alt}" width="1440" height="1080" loading="lazy" decoding="async" />
            <img class="food-showcase-image" alt="" aria-hidden="true" width="1440" height="1080" decoding="async" />
            <span class="food-photo-label">The Harla kitchen</span>
          </div>
          <div class="food-showcase-bar">
            <div class="food-showcase-caption"><span data-food-count>01 / 20</span><p data-food-caption>${first.title}</p></div>
            <div class="food-showcase-controls">
              <button type="button" data-food-prev aria-label="Previous food photo">←</button>
              <button type="button" data-food-play aria-label="Pause food slideshow">Ⅱ</button>
              <button type="button" data-food-next aria-label="Next food photo">→</button>
            </div>
          </div>
          <p class="food-sr-only" data-food-status role="status" aria-live="polite"></p>
        </div>
      </div>
      <details class="food-showcase-gallery">
        <summary>Browse all 20 photos <span aria-hidden="true">+</span></summary>
        <div class="food-showcase-thumbnails">
          ${restaurantPhotos.map((photo, index) => `<button type="button" data-food-photo="${index}" aria-label="Show photo ${index + 1}: ${photo.title}" aria-pressed="${index === 0}"><img data-src="${photo.src}" alt="${photo.alt}" width="240" height="180" loading="lazy" decoding="async" /><span>${String(index + 1).padStart(2, "0")}</span></button>`).join("")}
        </div>
      </details>
    </section>`;
}

export function initRestaurantShowcase() {
  const root = document.querySelector("[data-food-showcase]");
  if (!root) return;
  const player = root.querySelector(".food-showcase-player");
  const stage = root.querySelector("[data-food-stage]");
  const layers = [...stage.querySelectorAll("img")];
  const play = root.querySelector("[data-food-play]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let current = 0;
  let target = 0;
  let activeLayer = 0;
  let request = 0;
  let timer;
  let paused = reducedMotion.matches;
  let visible = false;
  let hovering = false;
  let focused = false;

  function schedule() {
    clearTimeout(timer);
    const playing = !paused && visible && !document.hidden && !hovering && !focused;
    player.classList.toggle("is-playing", playing);
    play.textContent = paused ? "▶" : "Ⅱ";
    play.setAttribute("aria-label", paused ? "Play food slideshow" : "Pause food slideshow");
    if (playing) timer = setTimeout(() => show(current + 1), 6500);
  }

  async function show(index, manual = false) {
    clearTimeout(timer);
    target = (index + restaurantPhotos.length) % restaurantPhotos.length;
    const nextIndex = target;
    const ticket = ++request;
    const photo = restaurantPhotos[nextIndex];
    if (manual) paused = true;
    const next = layers[1 - activeLayer];
    next.src = photo.src;
    try {
      await next.decode();
      if (ticket !== request) return;
      next.alt = photo.alt;
      next.removeAttribute("aria-hidden");
      layers[activeLayer].setAttribute("aria-hidden", "true");
      layers[activeLayer].classList.remove("is-active");
      next.classList.add("is-active");
      activeLayer = 1 - activeLayer;
      current = nextIndex;
      root.querySelector("[data-food-caption]").textContent = photo.title;
      root.querySelector("[data-food-count]").textContent = `${String(current + 1).padStart(2, "0")} / ${restaurantPhotos.length}`;
      root.querySelectorAll("[data-food-photo]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.foodPhoto) === current)));
      if (manual) root.querySelector("[data-food-status]").textContent = `Photo ${current + 1} of ${restaurantPhotos.length}: ${photo.title}`;
    } catch {
      if (ticket !== request) return;
      paused = true;
      root.querySelector("[data-food-status]").textContent = "This photo could not load. Please try another photo.";
    }
    schedule();
  }

  root.querySelector("[data-food-prev]").addEventListener("click", () => show(target - 1, true));
  root.querySelector("[data-food-next]").addEventListener("click", () => show(target + 1, true));
  play.addEventListener("click", () => { paused = !paused; schedule(); });
  player.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    show(target + (event.key === "ArrowRight" ? 1 : -1), true);
  });
  let touchStart;
  stage.addEventListener("touchstart", event => {
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  stage.addEventListener("touchend", event => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) show(target + (dx < 0 ? 1 : -1), true);
    touchStart = null;
  }, { passive: true });
  player.addEventListener("mouseenter", () => { hovering = true; schedule(); });
  player.addEventListener("mouseleave", () => { hovering = false; schedule(); });
  player.addEventListener("focusin", () => { focused = true; schedule(); });
  player.addEventListener("focusout", event => { focused = player.contains(event.relatedTarget); schedule(); });
  document.addEventListener("visibilitychange", schedule);
  reducedMotion.addEventListener("change", event => { if (event.matches) paused = true; schedule(); });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); }, { threshold: 0.25 }).observe(player);

  const gallery = root.querySelector("details");
  gallery.addEventListener("toggle", () => {
    if (!gallery.open) return;
    paused = true;
    schedule();
    gallery.querySelectorAll("img[data-src]").forEach(img => { img.src = img.dataset.src; delete img.dataset.src; });
  });
  root.querySelectorAll("[data-food-photo]").forEach(button => button.addEventListener("click", () => {
    show(Number(button.dataset.foodPhoto), true);
    player.scrollIntoView({ behavior: reducedMotion.matches ? "instant" : "smooth", block: "center" });
  }));
  schedule();
}
