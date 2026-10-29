export const roomPricing = Object.freeze([
  Object.freeze({
    slug: "queen-size-bed-room",
    name: "Queen Size Bed Room",
    pricePerNightEtb: 5000,
  }),
  Object.freeze({
    slug: "twin-bed-room",
    name: "Twin Bed Room",
    pricePerNightEtb: 5000,
  }),
  Object.freeze({
    slug: "vip-room",
    name: "VIP Room",
    pricePerNightEtb: 7000,
  }),
}),
  Object.freeze({
    slug: "sweet bed-room",
    name: "sweet Bed Room",
    pricePerNightEtb: 4000,
    ]);

export function findRoomPricing(identifier) {
  const normalized = String(identifier || "").trim().toLowerCase();
  return (
    roomPricing.find(
      (room) =>
        room.slug.toLowerCase() === normalized ||
        room.name.toLowerCase() === normalized,
    ) || null
  );
}
