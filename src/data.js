export const siteConfig = {
  // REPLACE: Add your final logo text or switch this to an image in Navbar.
  brandName: "Harla Hotel",
  tagline: "Warm Harari hospitality, refined for modern travel.",
  // REPLACE: Update phone, WhatsApp, email, address, and social/contact details before publishing.
  phone: "+251 915 321 188",
  whatsapp: "+251 915 321 188",
  email: "booking@harlahotel.com",
  address: "Harar, Ethiopia",
  // REPLACE: Update this Google Maps link if the final hotel listing changes.
  googleMapsUrl: "https://maps.app.goo.gl/ZR1Qz3pQxqCr7UnV6",
  facebook: "#",
  instagram: "#",
  tiktok: "#",
  // REPLACE: Change this to your Odoo, CRM, or booking API endpoint.
  bookingEndpoint: "/api/booking-inquiry",
  // REPLACE: Swap this placeholder with the real Odoo POS URL when Harla is ready to use it.
  odooPosUrl: "ODOO_POS_URL_PLACEHOLDER",
};

export const whatsappLinks = {
  room: `https://wa.me/${siteConfig.whatsapp.replace(/\D/g, "")}?text=Hello%20Harla%20Hotel%2C%20I%20want%20to%20book%20a%20room.`,
  table: `https://wa.me/${siteConfig.whatsapp.replace(/\D/g, "")}?text=Hello%20Harla%20Hotel%2C%20I%20want%20to%20see%20the%20restaurant%20menu.`,
  vipRoom: `https://wa.me/${siteConfig.whatsapp.replace(/\D/g, "")}?text=Hello%20Harla%20Hotel%2C%20I%20want%20to%20reserve%20the%20VIP%20private%20room.`,
  event: `https://wa.me/${siteConfig.whatsapp.replace(/\D/g, "")}?text=Hello%20Harla%20Hotel%2C%20I%20want%20to%20plan%20an%20event.`,
  package: `https://wa.me/${siteConfig.whatsapp.replace(/\D/g, "")}?text=Hello%20Harla%20Hotel%2C%20I%20want%20to%20request%20a%20tour%20package.`,
};

// REPLACE: Swap these placeholder/local image paths with your own hotel, room, restaurant, hall, and Harar experience photos.
export const images = {
  logo: "./assets/logo/harla-hotel-logo.jpeg",
  hero: "/assets/hotel/harla-hotel-exterior.jpeg",
  about: "./assets/hotel/harla-hotel-reception.jpeg",
  hallway: "./assets/hotel/harla-hotel-hallway.jpeg",
  reception: "./assets/hotel/harla-hotel-reception.jpeg",
  vipMajlis: "./assets/restaurant/harla-restaurant-gallery-1.jpeg",
  restaurantVipPrivateRoom: "./assets/restaurant/harla-restaurant-gallery-1.jpeg",
  restaurantVipGallerySeating: "./assets/restaurant/harla-restaurant-vip-gallery-seating.jpeg",
  restaurantVipGalleryRoom: "./assets/restaurant/harla-restaurant-vip-gallery-room.jpeg",
  restaurantVipLounge: "./assets/restaurant/harla-restaurant-vip-lounge.jpeg",
  eventHall: "./assets/events/harla-event-hall.jpeg",
  culturalPhotoLunchRoom: "./assets/events/harla-cultural-photo-lunch-room.jpeg",
  eventWeddingStage: "./assets/events/harla-event-wedding-stage.jpeg",
  eventRefreshments: "./assets/events/harla-event-refreshments.jpeg",
  eventDessertBuffet: "./assets/events/harla-event-dessert-buffet.jpeg",
  packageBrandWall: "./assets/packages/harla-packages-brand-wall.jpeg",
  // REPLACE: Swap this MP4 with the final Harla Hotel advertisement video when ready.
  videoAd: "./assets/video/harla-hotel-ad-preview.mp4",
  culturalHouseGate: "./assets/cultural/harari-cultural-house-gate.jpeg",
  culturalHouseRoom: "./assets/cultural/harari-cultural-house-room.jpeg",
  rooms: [
    "./assets/rooms/harla-room-bed.jpeg",
    "./assets/rooms/harla-room-desk.jpeg",
  ],
  restaurant: "./assets/restaurant/harla-restaurant-gallery-1.jpeg",
  event: "./assets/events/harla-event-hall.jpeg",
  packages: "./assets/packages/harla-packages-brand-wall.jpeg",
  gallery: [
    "./assets/hotel/harla-hotel-exterior.jpeg",
    "./assets/hotel/harla-hotel-reception.jpeg",
    "./assets/rooms/harla-room-bed.jpeg",
    "./assets/rooms/harla-room-desk.jpeg",
    "./assets/hotel/harla-hotel-hallway.jpeg",
    "./assets/restaurant/harla-restaurant-gallery-1.jpeg",
    "./assets/cultural/harari-cultural-house-room.jpeg",
    "./assets/cultural/harari-cultural-house-gate.jpeg",
    "./assets/events/harla-cultural-photo-lunch-room.jpeg",
    "./assets/events/harla-event-hall.jpeg",
    "./assets/packages/harla-packages-brand-wall.jpeg",
  ],
};

// REPLACE: Update room prices and images here when rates or room photography change.
// Live room counts now come from Supabase table: room_inventory.
export const roomBookingTypes = [
  {
    slug: "queen-size-bed-room",
    name: "Queen Size Bed Room",
    pricePerNight: 4000,
    priceLabel: "4,000 ETB per night",
    totalRooms: 8,
    availableRooms: 8,
    image: images.rooms[0],
    description: "A polished queen-size room for guests who want comfort, privacy, and warm Harla Hotel service.",
    features: ["Queen-size bed", "Private bathroom", "Wi-Fi", "Workspace"],
  },
  {
    slug: "twin-bed-room",
    name: "Twin Bed Room",
    pricePerNight: 4000,
    priceLabel: "4,000 ETB per night",
    totalRooms: 2,
    availableRooms: 2,
    image: images.rooms[1],
    description: "A flexible twin-bed room for friends, family members, and business guests traveling together.",
    features: ["Twin beds", "Private bathroom", "Smart TV", "Room service option"],
  },
  {
    slug: "vip-room",
    name: "VIP Room",
    pricePerNight: 7000,
    priceLabel: "7,000 ETB per night",
    totalRooms: 1,
    availableRooms: 1,
    image: images.culturalHouseRoom,
    description:
      "A special Harari-style VIP stay with a large cultural living room, private bedroom, and private bathroom.",
    features: ["VIP bedroom", "Harari traditional living room", "Private bathroom", "Cultural interior"],
  },
];

export const rooms = [
  {
    name: roomBookingTypes[0].name,
    price: roomBookingTypes[0].priceLabel,
    image: roomBookingTypes[0].image,
    bookingSlug: roomBookingTypes[0].slug,
    description: roomBookingTypes[0].description,
    amenities: ["Queen-size bed", "Workspace", "Wi-Fi", "Breakfast option"],
  },
  {
    name: roomBookingTypes[1].name,
    price: roomBookingTypes[1].priceLabel,
    image: roomBookingTypes[1].image,
    bookingSlug: roomBookingTypes[1].slug,
    description: roomBookingTypes[1].description,
    amenities: ["Twin beds", "Private bathroom", "Smart TV", "Room service"],
  },
  {
    name: roomBookingTypes[2].name,
    price: roomBookingTypes[2].priceLabel,
    image: roomBookingTypes[2].image,
    bookingSlug: roomBookingTypes[2].slug,
    description: roomBookingTypes[2].description,
    amenities: ["VIP bedroom", "Harari living room", "Private bathroom", "Cultural interior"],
  },
];

export const harariCulturalHouse = {
  title: "Harari Cultural House",
  description:
    "This large traditional Harari-style house is usually used by newly wedded couples, but it can also be booked for other special stays. It blends a spacious cultural living room with a private bedroom and warm Harari hospitality.",
  features: [
    "Spacious Harari traditional living room",
    "Private VIP bedroom",
    "Private bathroom",
    "Cultural interior design",
    "Suitable for couples, families, photography, and special occasions",
  ],
  gallery: [
    images.culturalHouseRoom,
    images.culturalHouseGate,
  ],
};

export const roomHighlights = [
  {
    label: "Room bedroom",
    image: images.rooms[0],
  },
  {
    label: "Room desk and TV",
    image: images.rooms[1],
  },
  {
    label: "Hotel hallway",
    image: images.hallway,
  },
];

export const hospitalityHighlights = [
  {
    title: "VIP Majlis Dining Rooms",
    text: "Private restaurant rooms with majlis seating for families, groups, and guests who want a more personal dining experience.",
  },
  {
    title: "Hotel VIP Lounge",
    text: "A calm hotel VIP room where guests can relax, enjoy coffee ceremony, meet friends, and spend time between activities.",
  },
];

export const vipRoomGallery = [
  {
    label: "VIP Room for lunch and coffee ceremony",
    image: images.restaurantVipPrivateRoom,
  },
  {
    label: "Luxury VIP mejlis seating",
    image: images.restaurantVipGallerySeating,
  },
  {
    label: "Private VIP room gathering area",
    image: images.restaurantVipGalleryRoom,
  },
];

export const restaurantPage = {
  title: "Harla Restaurant",
  description:
    "A warm dining experience for hotel guests, families, business meals, and special private gatherings.",
  vipTitle: "VIP Private Room",
  vipDescription:
    "The VIP Private Room is for customers who want extra privacy. It includes a traditional mejlis seating area and is suitable for private dining, family gatherings, business meals, and special occasions.",
  features: ["Traditional mejlis seating", "Private dining setting", "Family and business friendly", "Coffee ceremony option"],
};

export const culturalPhotoRoom = {
  title: "Cultural Photo & Lunch Room",
  description:
    "This cultural room is located next to the event halls. It contains Harari cultural attires and decorations, and customers can book it for wedding photography, cultural photo sessions, family photos, lunch gatherings, and small private gatherings.",
  features: [
    "Wedding photography",
    "Cultural photo sessions",
    "Family photos",
    "Lunch gatherings",
    "Small private gatherings",
    "Spacious Harari-themed photos and meals",
  ],
};

export const services = [
  {
    title: "Weddings",
    text: "Elegant hall setup, guest flow support, dining coordination, and photo-ready spaces.",
  },
  {
    title: "Conferences",
    text: "Professional seating plans, presentation support, refreshments, and calm service.",
  },
  {
    title: "Birthdays",
    text: "Warm celebrations with flexible decoration, food service, and family-friendly timing.",
  },
  {
    title: "Corporate Events",
    text: "Polished venue support for trainings, launches, retreats, and executive gatherings.",
  },
];

// REPLACE: Update event section photo labels and image paths as you add final event hall photography.
export const eventGallery = [
  {
    label: "Wedding stage setup",
    image: images.eventWeddingStage,
  },
  {
    label: "Refreshments for events",
    image: images.eventRefreshments,
  },
  {
    label: "Dessert buffet selection",
    image: images.eventDessertBuffet,
  },
];

export const packages = [
  {
    name: "2 Days / 1 Night Package",
    description:
      "A full Harla Hotel cultural stay for guests who want Harar's most memorable sights, flavors, and evening traditions in one easy package.",
    // REPLACE: Confirm final package inclusions, currency, and per-person pricing before publishing.
    included: [
      "1 night hotel stay coordination",
      "Harar city sightseeing",
      "Historical places visit",
      "Hyena feeding experience",
      "Cultural food and coffee experience",
      "Local guide support",
      "Pickup coordination",
    ],
    duration: "2 days / 1 night",
    price: "400 USD per person",
  },
  {
    name: "Harar Sightseeing Tour",
    description: "Step into the living story of Harar with a trusted local guide who helps every street feel meaningful.",
    // REPLACE: Update package details, inclusions, duration, and prices when final packages are confirmed.
    included: ["Hotel coordination", "Trusted local guide", "City route planning", "Photo stops"],
    duration: "Half day",
    price: "Price on request",
  },
  {
    name: "Custom Tour Guide Package",
    description: "Build a personal Harar itinerary around your schedule, interests, group size, and stay length.",
    included: ["Custom planning", "Guide matching", "Transport options", "Hotel + tour coordination"],
    duration: "Flexible",
    price: "Price on request",
  },
];

export const menuPreview = [
  "Traditional Ethiopian breakfast",
  "Fresh juices, coffee, and tea",
  "Harari-inspired lunch specials",
  "Grilled meats and vegetarian plates",
  "Pastries and celebration cakes",
  "Private group dining menus",
];

// REPLACE: Update restaurant menu names, categories, descriptions, and prices when the final menu is ready.
export const restaurantMenuItems = [
  {
    id: "harari-breakfast",
    category: "Breakfast",
    name: "Harari Breakfast Plate",
    description: "A warm breakfast plate with tea or coffee service.",
    price: 350,
  },
  {
    id: "ethiopian-breakfast",
    category: "Breakfast",
    name: "Traditional Ethiopian Breakfast",
    description: "Classic morning flavors for hotel guests and walk-in customers.",
    price: 320,
  },
  {
    id: "special-lunch",
    category: "Lunch",
    name: "Harla Special Lunch",
    description: "A generous lunch plate prepared for dine in, take away, or delivery.",
    price: 520,
  },
  {
    id: "grilled-meat",
    category: "Lunch",
    name: "Grilled Meat Plate",
    description: "Grilled meat with sides and fresh accompaniments.",
    price: 650,
  },
  {
    id: "vegetarian-plate",
    category: "Lunch",
    name: "Vegetarian Plate",
    description: "A satisfying vegetarian selection with local flavor.",
    price: 420,
  },
  {
    id: "fresh-juice",
    category: "Drinks",
    name: "Fresh Juice",
    description: "Seasonal fresh juice prepared to order.",
    price: 180,
  },
  {
    id: "coffee-ceremony",
    category: "Drinks",
    name: "Coffee Ceremony",
    description: "A relaxed coffee ceremony experience for dine-in guests.",
    price: 300,
  },
  {
    id: "tea",
    category: "Drinks",
    name: "Tea",
    description: "Hot tea served fresh.",
    price: 90,
  },
];

// Delivery-only pastry options. Cookies are ordered in kilograms.
export const deliveryPastryItems = [
  { id: "cake", name: "Cake" },
  { id: "cookies", name: "Cookies" },
  { id: "pastries", name: "Pastries" },
  { id: "cupcakes", name: "Cupcakes" },
];

export const restaurantAddressAreas = [
  "Arategna",
  "Feres Megala",
  "Shash Garage",
  "Jugol",
  "Piazza",
  "Harar University Area",
  "Other",
];

export const restaurantPaymentMethods = [
  {
    value: "cbe",
    label: "CBE",
    instructions: "CBE: 1000703782756 - Harla Hotel",
  },
  {
    value: "telebirr",
    label: "Telebirr",
    instructions: "Telebirr: 0915321828 - Rekib",
  },
  {
    value: "ebirr",
    label: "E-Birr",
    instructions: "E-Birr: 0915321188",
  },
];
