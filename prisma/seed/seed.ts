import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const prisma = new PrismaClient();

// ── Categories, one per POS bucket, matching the old hardcoded UI groups ──
const categories = [
  { name: "Main Course", bucketType: "MEALS" as const, sortOrder: 1 },
  { name: "Beverages", bucketType: "DRINKS" as const, sortOrder: 2 },
  { name: "Desserts", bucketType: "DESSERTS" as const, sortOrder: 3 },
  { name: "Sides & Starters", bucketType: "SIDES" as const, sortOrder: 4 },
];

// ── Menu items, carried over from the old hardcoded arrays ──
const mealsItems = [
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuAjafr_jI2kYqJtqhOHUliKCH-AQKg4ypYa1Z6uQYY25LibkZ-pH75wv3ZOXYHWKBk_YaYTVuq7OlowZb3yccg8I7V8vp4DIT614HZYNqaLVxkiq89XTBwBre6KWnCd-VK0zCHR-2Hvr5s-YjJjMyLtDc6uX9blYUEc3XB943yeydjqOOeXWWpEXW_OBHK3weo6rzN4eBbK30WnHOUyzCiAdLOHIm1h1RBNnU4g8yaxgQmzWV4p-chjJGykuye0cVG_1hmDzNpdwNs", price: 18.5, name: "Avocado Harvest Bowl", desc: "Quinoa base, roasted chickpeas, citrus vinaigrette." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuBTMCAayuNHm5HeiQSw51Fz_v4DgeVDdgPoGuV3Td79bNSyWCQaLh8-tHd5VFPNAGEN4oV81Qpq1_IP_q8XFwFC_ijOdsmLZiWn33rhpOEX5Q05sWZneJ6X1q3DXAf8AX-vUm5zRfMyuCCXTI3771qzktnblouYyC-N-Lx23lpPMLV4QrOVhlT8-wUe2VXrIkSFpNzEgaQ0TBI3EiVvywS0jn3jfwrNAxdbi1WsCY7fEf0YIMs5vYxowh5DGNQONar-8zEjMzRALyk", price: 14.0, name: "Buttermilk Stack", desc: "Triple layer, organic maple syrup, whipped butter." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuDSZBWY7jcNHuts7WE6mrJ0-G54O-l1NoJjG537Irm4NLK5WWL1sWE-i_kIrpBnTZt_lUIZ5AqmLfFIz7a8B-nMoBbBR_-nGO8ee3yJyajeYLp3TVXb-Qr0dWIzWtok855OklJxTr4o8nsOvmVdvK0sGP9QNQFxB3GDsEPBQUb5P6Lf1AlFHHR9d27wAzh-dAbyPIEJJzycFD62hEASgq1DulBDQeG72xgCo-lQx3aJKDOPctfhCr1UCrtsvz1Qs0QyKiTNiUqkRBg", price: 26.0, name: "Wild Atlantic Salmon", desc: "Sustainably sourced, lemon-herb glaze, asparagus." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuB4zpw0IcTkfRzfafegc1RAOahK5TZSfv2vcIOse7kAOIAxSeTDDRNwudwo9wi0JqfOxgaRxZUDoaSZyDfjJ6eG9vHfi_GKJGzPgZDCvoRm2eJr1te4YmcLiE1JdRl1d93jubwzFJo48t_PLxEp8Zp4H53Gvq1Os_dlP7Uhv-QOZERPTOa89LvoDULP8jLxkgGXFDzpVLDddbuQRsonZA359fs6BZpp0St4TxLJU3N2s4xQHkIoaDFXpqI0sL6itzvmxb8p5zZ7QPk", price: 22.5, name: "Truffle Carbonara", desc: "Handmade tagliatelle, guanciale, black truffle oil." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuCnmCh5f5FwP-Lej_mJNn8zLR_yMINw0kwRJsoiL8VLRxS-1JMje6F7mzQail72_OeMytcHn1Jxepo0dQbcWzLHViBeWYtHB5N8r982_yqdfXFjMExMfE7_WOQbNStf6KzaQsfxcMjXdacWjO5I2JXaeZCySSa_r-nQ60alDhBt-2aLOJi1dMWSxa4OyyHno3kr-bryBUIc5b3t-VZ3mZb3gw2E6YHEFiqDax3WlyicKJL4FvkGYQOqz-umUAtPfWU2OEn3xo9EqxQ", price: 19.0, name: "Margherita Classica", desc: "San Marzano tomatoes, fresh buffalo mozzarella, basil." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuBjgys5WEzm_MUWmNnI3YT8dTgN64TxxCLsr06D4LlT5E8WTBrMNJZ7lWkSHdx8K-hafXF0S15AhYl2USLqONPkm5gc4AuKnVaRMsZtbK_nB3lKxH-oPha7RaexZOFxNJSUp6wJSf4IHjghBBd8bQwCRt6GRcdNvHS_kGM97rtqcZwpBC5T22C1-EvKiaOQqKTsQ9lQY-WTjmgZJLf4AfTXt4Qkl03Gz04i2JstNpiIEL8Jfp3JqqL96av5nUTtJI0R5kiVeXISFkw", price: 32.0, name: "Braised Short Rib", desc: "12-hour slow braise, creamy mash, red wine reduction." },
];

const drinksItemsData = [
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuBg7vn2bFl89AcmoYm8OkVMhKAkmHldrVx-nj_7A8wj44H1kjjQt5oBYmhGANAN-rgSLHuYu8z7jtD7kFE0cRIcJbQqTF_BOQyJaa0sMrW1LYLRavm7x3pWnwlvy7upQ0SMXgrTvk-3D5x6cbZYfRM8M_fx4NmI-eGbGiM9fcnLbT4iS76_0Qhj9N0TgXV7xQIUQ_fosl_h4SbNKWSg-SjBfhiNU-zVgacTiUdOCeHwwXbhechR16KTdQyA6jg9S5wVBF1_4yRWxiM", price: 18.0, name: "The Crimson Editorial", desc: "Aged bourbon, house-made cherry bitters, and a whisper of smoke. Served up." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuD65o4wGQ1I85_H7SAalMDwvhs_-3Rq24fXsJcVhPGpkgsvMv3jKaIPNghm-4uWSuRFrfldfWV6aJKh682hdpQeTOLP1XWmyTuCUKW7IDzaIez6-20tGGWpnfSIWST6t4E4oFBc0cMIjx6zxjw79vghhE91W1s4Z68uVo0DUymR2OS4yVfs9nAOf1UYwemq0-AJC14QVUmBvEqnr722sqexQebrWikhqi7e2_Qio2Sj29JbDqlVzZoGCTmB1P372UqC_0u2Bk1yJJg", price: 9.0, name: "Jasmine Silver Needle", desc: "Delicate white tea infused with night-blooming jasmine flowers." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuDSzrHdt71Bsdio1bsS93DCP9No7f5sxCxZVrHjH4KR8212wIVRYiH_vJIri5VBoWO1ecO-Q7vP5Q0SLX5ZUKGgdjGINbijnJAuwTgHRJOfc3CxPIw_al_KNCQvdbqoymh8yGdKT8djSPDS6Y0ePmD9yq6PKMLXmcbbPvm0TnZ0hyM6FcFc3RmOmAEUCbPVDoRUvmPtYAyQaUDI8PHtB1DTvOAMRXNMq6vE6RZb82brBP1zp8QaWySMth56dGxqsmE01VcCFBK4QI0", price: 240.0, name: "Château Margaux 2015", desc: "Exceptional vintage with complex aromas of blackcurrant, violet, and cedar." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuCaB5RFScaIRocyHwAyTjBR4_-3A5hch4TjSsG3KnBatiZDfH_lbluSCVCF8ifoahaW30nadF9O8rImHmpVyF1ZeBFpx63SIaM3vHvO9jjnomm8A1VT7yUPp_9szziYdmg7sc4-eKcnB1Dss97C6GxCS8Y98G62kyhUadIOu6u2V13xxrvAMbMM7Op3Yj8vv30SFdm1LrS2Qj3NZLo7VlOnIchbNhgqva0rTqUQodx5aTgsTDA78s3UEve9NYtZmxhyHJnPD12tOPc", price: 12.0, name: "Hearthside Ale", desc: "Local craft pale ale with notes of pine and citrus. Draft." },
];

const dessertItemsData = [
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuALVLGNUzugBCXuKBezT9SOIiF2ucDacCrWgckxT2RKb5VBUTI4fsPyKvg_DSLUTabcUS1sqIQuUAH45J401_i3RF9T0gHZy_zq7ipjtTAsNwt5G8Pck7stArwAF1hcHpsWjtcleUIKIx3Sg6z3iR4krvwhM9QrRI4rEEaVdADSmhKi_brCVnZU5S0w4Qpqvg2WRmYikxiu1fbNzKOjMOKtNEwYh_yCih5O5t_XT924VX4R6k_bq9oFjt2sDUEFrzbotETxm2pVCbc", price: 14.0, name: "Midnight Lava Cake", desc: "70% Valrhona dark chocolate, espresso dust, vanilla bean gelato." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuAo7VWqjGgqTTvbcipceywnYSwDltOsHqu6N_BkKdf8nFXPjz-N0uSWGrINDelXa6zMP2c_2zviQpIwjgmJjIDlTB8h8L4m05IhOa8eAYnBnyUhvGSeLg8zMZOeQ_LUwSfdpZCBsRzP5dXo6LBk4worngO76P4XZRO6AY_XfpoF-G3uT81YDeEeKuqCZgQiRGDDvZwLHGfypHAWrHN2zT8SHOtcnRMcIxWh3UeWec3UMxrfvu__XSowKryWCa3Jgs5xaCxwA89ZMY0", price: 12.0, name: "Saffron Poached Pears", desc: "Cardamom cream, pistachios." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuB23kR7SIlWZsMo_wVW946QE4ke3no70rBJVsGpWtP9u6MK3ZN3YGS_DAbMyxz2yrumA-J6B0kAJveEfwUQp1JCJ5gcdBqINTRzqCJhW3Hhv3vf61JP1rHsm_V0tgXm3YpytIbxqfJlPXwBJnVABGnHr8PkQC7ZqTsjVWZpINBUEL_SBdmOyLZKYUQhmIY5nZF5Hv8oKtZzYZqyx-7TrErwEe0oXE0jLrrLL8wi4Y-_9Pp92yQ3vx8HS-rTBxzKT_e0TwBX3OtSOSk", price: 16.0, name: "Truffle Carbonara Sweet", desc: "White chocolate, spun sugar." },
];

const sideItemsData = [
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuDh-vKU5vVK8bfdm8XaHymrOyhz3lZCXbHmWGixwDjzgfnGBd5pzt_BTkGkggbf_5vmgXvnKqGnnX-aWieTHrPFtwXjTw6Xz5VTk7j6sO_K_AgO1bpUZVj5y3JObQJXplXcsS8wHhjfY8xf3w3TIAl0S31vc4CsSSmujFdu-5aRGw_H3mZzvoWAIquKi14HhCEnKl_hCRKhj0s_yAsHcsQ3kYCmciWcsw4pdqHdjp_2CLrWb-eHL3yaIm-IvxkIvwjm5Ru-2bXyiFo", price: 12.0, name: "Truffle Parmesan Fries", desc: "Hand-cut russet potatoes, white truffle oil, aged Parmigiano-Reggiano." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuCtPtOp1wftNktMjnOOJO2Ntt_iszoasPU4EM4IdswAET5aMSioXThaoYZ058LNjhSX2teP3lOJ6QbW1H2n4i-RYgYS0NkpMFhXT4Ww4QU7D7cWstqLVlYKnrMC9IZRaVHnWqWMthOvYB35UXs4AHNQRd6XbCKoICCrMU2jw1_OhwLfGaljRngbyxM5CU8wQF0sjAfGEEfSI9dkpdm-QPvHxR9YeUVTSpUU2BHpT9xZbrb5P3GAf-HQV9uOXZSl6AFfjktNVo6y-rM", price: 14.0, name: "Market Greens", desc: "Locally sourced tender greens, shaved radish, champagne vinaigrette." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuBb-fppEJIxIgkTI6JDQsO1FRvOJO0y6AC1366n63COY8nLRm821l7w3MFJBakbiiEFwIvtUfwXVeuZuimhA-lF3ZNS_mVq5HMv6eo8m5u9OuLQkyz0aOTCSc0wcUNFKI_DUBed0bENCKiMFD8II3_izBBaf7EWa-qt5oTgChmlPYRXoFyTsUDpwZJfK1ZJUV2-6I0QhuGQkRWOH1XMbYTnpppn6xBhLUC06xlUweHpmA0_w5hcAOQDhq2MaqDM-3F0_uDxawVKW9U", price: 9.0, name: "Artisanal Sourdough", desc: "House-fermented sourdough boule served warm with cultured sea salt butter." },
  { img: "https://lh3.googleusercontent.com/aida-public/AB6AXuBbWAnal7Xqndpnn54is7G-KmRR9TfqQ5u2FsEXqM4u8DEKb7g_x4_TQ4DmIlpcDGDcEumKSlPOP-_iLY_dnFefrPleJC2-v2HSA4SKpAqrSVfwOsZB3rEZQo7mA2E52q-xAnPslhsmGKmdAuq2iLQQ9eQcTJBjc1_wWHxy-sBcvWAEleGxeasRhVOzQM-3rr6Oxm3w5AflXc2Wo7vB9Eja66KQ8NCsxlt3x8U9e5qKvSYpHdLhguWnNokqVVezwzfi43MjWNtqvFc", price: 16.0, name: "Charred Asparagus", desc: "Fire-roasted jumbo asparagus, preserved lemon emulsion, toasted almonds." },
];

// Auto-generate a unique SKU from the item name, since the old hardcoded data had none.
function skuFrom(name: string, index: number) {
  return `MEN-${name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 20)}-${index}`;
}

async function seedCategoryItems(
  categoryName: string,
  items: { img: string; price: number; name: string; desc: string }[]
) {
  const category = await prisma.category.findUnique({ where: { name: categoryName } });
  if (!category) throw new Error(`Category "${categoryName}" not found — did the category seed step run?`);

  for (const [i, item] of items.entries()) {
    await prisma.menuItem.upsert({
      where: { name: item.name },
      update: {
        description: item.desc,
        price: new Decimal(item.price.toFixed(2)),
        image: item.img,
        categoryId: category.id,
      },
      create: {
        name: item.name,
        description: item.desc,
        price: new Decimal(item.price.toFixed(2)),
        sku: skuFrom(item.name, i),
        image: item.img,
        categoryId: category.id,
      },
    });
  }
}

async function main() {
  console.log("Seeding categories...");
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: { bucketType: cat.bucketType, sortOrder: cat.sortOrder },
      create: { name: cat.name, bucketType: cat.bucketType, sortOrder: cat.sortOrder, isActive: true },
    });
  }

  console.log("Seeding menu items...");
  await seedCategoryItems("Main Course", mealsItems);
  await seedCategoryItems("Beverages", drinksItemsData);
  await seedCategoryItems("Desserts", dessertItemsData);
  await seedCategoryItems("Sides & Starters", sideItemsData);

  console.log("Done — 4 categories, 21 menu items seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());