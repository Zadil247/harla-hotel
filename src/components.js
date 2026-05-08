import {
  harariCulturalHouse,
  hospitalityHighlights,
  images,
  menuPreview,
  packages,
  restaurantPage,
  roomHighlights,
  rooms,
  services,
  siteConfig,
  vipRoomGallery,
  whatsappLinks,
} from "./data.js?v=20260507-supabase";

const navLinks = [
  ["About", "./index.html#about", "about"],
  ["Rooms", "./index.html#rooms", "rooms"],
  ["Restaurant", "./restaurant.html", "restaurant"],
  ["Event Hall", "./event-hall.html", "events"],
  ["Packages", "./index.html#packages", "packages"],
  ["Gallery", "./index.html#gallery", "gallery"],
  ["Location", "./index.html#location", "location"],
  ["Contact", "./index.html#contact", "contact"],
];

export function Navbar(active = "home") {
  return `
    <header class="site-header" data-header>
      <nav class="navbar" aria-label="Main navigation">
        <a class="brand" href="./index.html#home" aria-label="${siteConfig.brandName} home">
          <!-- REPLACE: Update the logo file at assets/logo/harla-hotel-logo.jpeg if needed. -->
          <img class="brand-logo" src="${images.logo}" alt="" />
          <span>
            <strong>${siteConfig.brandName}</strong>
            <small>Hotel • Restaurant • Events • Tours</small>
          </span>
        </a>
        <button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false" data-nav-toggle>
          <span></span><span></span><span></span>
        </button>
        <div class="nav-menu" data-nav-menu>
          ${navLinks
            .map(
              ([label, href, key]) =>
                `<a class="${active === key ? "is-active" : ""}" href="${href}">${label}</a>`,
            )
            .join("")}
          <a class="nav-cta" href="./index.html#booking">Book Now</a>
        </div>
      </nav>
    </header>
  `;
}

export function Hero() {
  return `
    <section class="hero" id="home" style="--hero-image: url('${images.hero}')">
      <div class="hero-overlay"></div>
      <div class="hero-content reveal">
        <p class="eyebrow">Stay, dine, celebrate, and explore Harar with Harla Hotel.</p>
        <h1>${siteConfig.brandName}</h1>
        <p>From comfortable rooms to cultural adventures, Harla Hotel makes your visit complete.</p>
        <div class="hero-actions" aria-label="Primary actions">
          <a class="btn btn-primary" href="./book-room.html">Book a Room</a>
          <a class="btn btn-light" href="./restaurant.html">Reserve Table</a>
          <a class="btn btn-outline" href="./event-hall.html">Plan Event</a>
          <a class="btn btn-whatsapp" href="${whatsappLinks.room}">WhatsApp Room</a>
        </div>
      </div>
    </section>
  `;
}

export function RoomCard(room) {
  return `
    <article class="room-card reveal">
      <img src="${room.image}" alt="${room.name}" loading="lazy" />
      <div class="room-card-body">
        <div>
          <p class="card-kicker">${room.price}</p>
          <h3>${room.name}</h3>
          <p>${room.description}</p>
        </div>
        <ul class="amenities">
          ${room.amenities.map((item) => `<li>${item}</li>`).join("")}
        </ul>
        <div class="card-actions">
          <a class="text-link" href="./book-room.html?room=${room.bookingSlug}">Book Now</a>
          <a class="mini-whatsapp" href="${whatsappLinks.room}">WhatsApp</a>
        </div>
      </div>
    </article>
  `;
}

export function ServiceCard(service) {
  return `
    <article class="service-card reveal">
      <span aria-hidden="true"></span>
      <h3>${service.title}</h3>
      <p>${service.text}</p>
    </article>
  `;
}

export function PackageCard(packageDeal) {
  const serviceType =
    packageDeal.name === "Custom Tour Guide Package" ? "Custom package request" : "Hotel + tour package";

  return `
    <article class="package-card reveal">
      <div>
        <p class="card-kicker">${packageDeal.price}</p>
        <h3>${packageDeal.name}</h3>
        <p>${packageDeal.description}</p>
      </div>
      <div>
        <strong>What's included</strong>
        <ul>
          ${packageDeal.included.map((item) => `<li>${item}</li>`).join("")}
        </ul>
      </div>
      <div class="package-meta">
        <span>${packageDeal.duration}</span>
        <a class="text-link" href="#booking" data-service-shortcut="${serviceType}" data-package-shortcut="${packageDeal.name}">Request Package</a>
      </div>
      <a class="mini-whatsapp" href="${whatsappLinks.package}">WhatsApp Package</a>
    </article>
  `;
}

export function PackagesSection() {
  return `
    <section class="section packages" id="packages" aria-labelledby="packages-title">
      <div class="packages-intro reveal">
        <div>
          <p class="eyebrow">Packages & Experiences</p>
          <h2 id="packages-title">Stay at Harla Hotel, then experience Harar with confidence</h2>
          <p>
            Experience Harar with trusted local guides. Package deals help guests combine hotel booking with
            sightseeing, cultural food, coffee, transfers, and guided experiences.
          </p>
        </div>
        <img src="${images.packages}" alt="Travel experience preview for guests visiting Harar" loading="lazy" />
      </div>
      <div class="package-grid">
        ${packages.map(PackageCard).join("")}
      </div>
    </section>
  `;
}

export function VideoAdSection() {
  return `
    <section class="section video-ad" id="video" aria-labelledby="video-ad-title">
      <div class="section-heading reveal">
        <p class="eyebrow">Future Video</p>
        <h2 id="video-ad-title">Experience Harla Hotel & Harar</h2>
        <p>Watch a preview of the dining and hospitality experience at Harla Hotel.</p>
      </div>
      <!-- REPLACE: Update images.videoAd in src/data.js with your final hotel advertisement video file. -->
      <figure class="video-placeholder reveal">
        <video controls preload="metadata" playsinline poster="${images.hero}">
          <source src="${images.videoAd}" type="video/mp4" />
          Your browser does not support the video tag.
        </video>
        <figcaption>Hotel rooms • VIP dining • Events • Harar tours</figcaption>
      </figure>
    </section>
  `;
}

export function HarariCulturalHouseSection() {
  return `
    <section class="section cultural-house" aria-labelledby="cultural-house-title">
      <div class="cultural-house-copy reveal">
        <p class="eyebrow">Special Accommodation</p>
        <h2 id="cultural-house-title">${harariCulturalHouse.title}</h2>
        <p>${harariCulturalHouse.description}</p>
        <ul class="feature-list">
          ${harariCulturalHouse.features.map((item) => `<li>${item}</li>`).join("")}
        </ul>
        <div class="hero-actions">
          <a class="btn btn-primary" href="./book-room.html?room=cultural-king-room">Request Stay</a>
          <a class="btn btn-whatsapp" href="${whatsappLinks.room}">WhatsApp Room</a>
        </div>
      </div>
      <div class="cultural-house-gallery reveal">
        <!-- REPLACE: Add final Harari Cultural House photos here when available. -->
        ${harariCulturalHouse.gallery
          .map(
            (image, index) => `
              <figure>
                <img src="${image}" alt="${harariCulturalHouse.title} photo ${index + 1}" loading="lazy" />
              </figure>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

export function RestaurantPreview() {
  return `
    <section class="section preview-band restaurant-preview" aria-labelledby="restaurant-preview-title">
      <div class="preview-copy reveal">
        <p class="eyebrow">Restaurant</p>
        <h2 id="restaurant-preview-title">Private dining, warm service, and Harari flavor</h2>
        <p>
          Reserve a table or a VIP private room with traditional mejlis seating for family meals, business meals,
          and special occasions.
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="./restaurant.html">Open Restaurant Page</a>
          <a class="btn btn-light" href="${whatsappLinks.table}">WhatsApp Table</a>
        </div>
      </div>
      <img class="preview-image reveal" src="${images.restaurant}" alt="${restaurantPage.vipTitle}" loading="lazy" />
    </section>
  `;
}

export function EventPreview() {
  return `
    <section class="section preview-band event-preview" aria-labelledby="event-preview-title">
      <div class="preview-copy reveal">
        <p class="eyebrow">Event Hall</p>
        <h2 id="event-preview-title">Plan weddings, conferences, and cultural celebrations</h2>
        <p>
          Choose your event time, guest count, and catering style on the dedicated Event Hall page.
          The cultural photo and lunch room can also be requested for Harari-themed photos and meals.
        </p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="./event-hall.html">Open Event Hall Page</a>
          <a class="btn btn-whatsapp" href="${whatsappLinks.event}">WhatsApp Event</a>
        </div>
      </div>
      <img class="preview-image reveal" src="${images.event}" alt="Harla Hotel event hall preview" loading="lazy" />
    </section>
  `;
}

export function Gallery() {
  const labels = [
    "Harla Hotel Exterior",
    "Hotel Reception Area",
    "Room Bedroom",
    "Room Desk",
    "Hotel Hallway",
    "VIP Private Room",
    "Luxury VIP Mejlis Seating",
    "Private VIP Gathering Room",
    "Harari Cultural House",
    "Cultural House Gate",
    "Cultural Photo & Lunch Room",
    "Restaurant VIP Lounge",
    "Event Hall",
    "Packages Reception",
  ];

  return `
    <section class="section gallery-section" id="gallery" aria-labelledby="gallery-title">
      <div class="section-heading reveal">
        <p class="eyebrow">Gallery</p>
        <h2 id="gallery-title">A preview of the Harla experience</h2>
        <p>Use this section for your real hotel, room, restaurant, and hall photography.</p>
      </div>
      <div class="gallery-grid">
        ${images.gallery
          .map(
            (image, index) => `
              <figure class="gallery-item reveal">
                <img src="${image}" alt="${labels[index]} preview at Harla Hotel" loading="lazy" />
                <figcaption>${labels[index]}</figcaption>
              </figure>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

export function VipRoomGallerySection() {
  return `
    <section class="section vip-room-gallery" aria-labelledby="vip-room-gallery-title">
      <div class="section-heading reveal">
        <p class="eyebrow">Hotel VIP Rooms</p>
        <h2 id="vip-room-gallery-title">Luxurious private rooms for lunch and coffee ceremony</h2>
        <p>
          Guests can book these VIP hotel rooms to relax, enjoy a coffee ceremony, share lunch, and spend private
          time in a warm Harari-inspired setting.
        </p>
      </div>
      <div class="gallery-grid compact-gallery">
        ${vipRoomGallery
          .map(
            (item) => `
              <figure class="gallery-item reveal">
                <img src="${item.image}" alt="${item.label}" loading="lazy" />
                <figcaption>${item.label}</figcaption>
              </figure>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

export function BookingForm() {
  return `
    <form class="booking-form reveal" id="booking-form">
      <div class="form-grid">
        <label>
          Full name
          <input name="fullName" type="text" autocomplete="name" required />
        </label>
        <label>
          Phone
          <input name="phone" type="tel" autocomplete="tel" required />
        </label>
        <label>
          Email
          <input name="email" type="email" autocomplete="email" />
        </label>
        <label>
          Service type
          <select name="serviceType" id="service-type" required>
            <option value="">Select a service</option>
            <option>Hotel booking only</option>
            <option>Restaurant reservation</option>
            <option>VIP Private Room reservation</option>
            <option>Event hall booking</option>
            <option>Cultural Photo & Lunch Room booking</option>
            <option>Hotel + tour package</option>
            <option>Custom package request</option>
          </select>
        </label>
        <label data-hotel-field>
          Check-in date
          <input name="checkIn" type="date" />
        </label>
        <label data-hotel-field>
          Check-out date
          <input name="checkOut" type="date" />
        </label>
        <label data-room-field>
          Preferred room
          <select name="roomType" id="room-type">
            <option value="">Select a room or suite</option>
            ${rooms.map((room) => `<option>${room.name}</option>`).join("")}
            <option>${harariCulturalHouse.title}</option>
          </select>
        </label>
        <label data-event-field>
          Event date
          <input name="eventDate" type="date" />
        </label>
        <label data-package-field>
          Preferred package
          <select name="packageName" id="package-name">
            <option value="">Select a package</option>
            ${packages.map((packageDeal) => `<option>${packageDeal.name}</option>`).join("")}
            <option>Custom package request</option>
          </select>
        </label>
        <label>
          Number of guests
          <input name="guests" type="number" min="1" placeholder="2" />
        </label>
        <label class="form-wide">
          Message
          <textarea name="message" rows="5" placeholder="Tell us what you would like to book..."></textarea>
        </label>
      </div>
      <button class="btn btn-primary" type="submit">Send Inquiry</button>
      <p class="form-status" role="status" aria-live="polite"></p>
    </form>
  `;
}

export function Footer() {
  return `
    <footer class="footer">
      <div>
        <a class="brand footer-brand" href="./index.html#home">
          <img class="brand-logo" src="${images.logo}" alt="" />
          <span><strong>${siteConfig.brandName}</strong><small>${siteConfig.tagline}</small></span>
        </a>
      </div>
      <address>
        <!-- REPLACE: Update phone, WhatsApp, email, and address in src/data.js. -->
        <a href="tel:${siteConfig.phone.replaceAll(" ", "")}">${siteConfig.phone}</a>
        <a href="https://wa.me/${siteConfig.whatsapp.replace(/\D/g, "")}">WhatsApp</a>
        <a href="mailto:${siteConfig.email}">${siteConfig.email}</a>
        <span>${siteConfig.address}</span>
      </address>
      <div class="social-links" aria-label="Social media links">
        <a href="${siteConfig.facebook}">Facebook</a>
        <a href="${siteConfig.instagram}">Instagram</a>
        <a href="${siteConfig.tiktok}">TikTok</a>
      </div>
    </footer>
  `;
}

export function App() {
  return `
    ${Navbar("home")}
    <main id="main">
      ${Hero()}
      <section class="section about" id="about" aria-labelledby="about-title">
        <div class="about-media reveal">
          <img src="${images.about}" alt="Elegant Harla Hotel lounge and hospitality area" loading="lazy" />
        </div>
        <div class="about-copy reveal">
          <p class="eyebrow">About Harla Hotel</p>
          <h2 id="about-title">Designed for rest, dining, and unforgettable gatherings.</h2>
          <p>
            Stay, dine, celebrate, and explore Harar with Harla Hotel. From comfortable rooms to cultural
            adventures, Harla Hotel makes your visit complete.
          </p>
          <p>
            Experience Harar with trusted local guides and a warm hospitality style inspired by Ethiopia and Harari culture.
          </p>
          <dl class="stats">
            <div><dt>4</dt><dd>Core services</dd></div>
            <div><dt>24/7</dt><dd>Inquiry support</dd></div>
            <div><dt>Flexible</dt><dd>Stays, events & tours</dd></div>
          </dl>
        </div>
      </section>

      ${VideoAdSection()}

      <section class="section rooms-section" id="rooms" aria-labelledby="rooms-title">
        <div class="section-heading reveal">
          <p class="eyebrow">Rooms & Suites</p>
          <h2 id="rooms-title">Comfortable stays with a premium touch</h2>
          <p>Room prices are ready for your final rates. Each card can connect directly to your booking workflow later.</p>
        </div>
        <div class="room-grid">
          ${rooms.map(RoomCard).join("")}
        </div>
        <div class="room-photo-strip reveal" aria-label="Actual Harla Hotel room and hallway photos">
          ${roomHighlights
            .map(
              (item) => `
                <figure>
                  <img src="${item.image}" alt="${item.label} at Harla Hotel" loading="lazy" />
                  <figcaption>${item.label}</figcaption>
                </figure>
              `,
            )
            .join("")}
        </div>
      </section>

      ${HarariCulturalHouseSection()}
      ${VipRoomGallerySection()}
      ${RestaurantPreview()}
      ${EventPreview()}

      ${PackagesSection()}

      ${Gallery()}

      <section class="section contact" id="contact" aria-labelledby="contact-title">
        <div class="contact-copy reveal">
          <p class="eyebrow">Contact & Booking Inquiry</p>
          <h2 id="contact-title">Tell Harla Hotel what you need</h2>
          <p>
            Send a booking inquiry for rooms, restaurant reservations, event hall planning, or hotel + tour
            packages. Submissions can save to Supabase once your project URL and public anon key are configured.
          </p>
          <div class="contact-list">
            <a href="tel:${siteConfig.phone.replaceAll(" ", "")}">${siteConfig.phone}</a>
            <a href="https://wa.me/${siteConfig.whatsapp.replace(/\D/g, "")}">WhatsApp: ${siteConfig.whatsapp}</a>
            <a href="mailto:${siteConfig.email}">${siteConfig.email}</a>
            <span>${siteConfig.address}</span>
          </div>
        </div>
        <div id="booking">
          ${BookingForm()}
        </div>
      </section>

      <section class="section location" id="location" aria-labelledby="location-title">
        <div class="section-heading reveal">
          <p class="eyebrow">Location</p>
          <h2 id="location-title">Find Harla Hotel</h2>
          <p>Open Harla Hotel on Google Maps for directions and location details.</p>
        </div>
        <!-- REPLACE: Paste your Google Maps embed iframe here. -->
        <div class="map-placeholder reveal">
          <span>Harla Hotel on Google Maps</span>
          <small>${siteConfig.address}</small>
          <a class="btn btn-primary" href="${siteConfig.googleMapsUrl}" target="_blank" rel="noopener">Open in Google Maps</a>
        </div>
      </section>
    </main>
    ${Footer()}
  `;
}
