import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')
  
  const allergens = [
    { name: "Dairy" },
    { name: "Gluten" },
    { name: "Nuts" },
    { name: "Soy" },
    { name: "Shellfish" },
  ];
  console.log('📝 Seeding allergens...')
  for (const allergen of allergens) {
    await prisma.allergen.upsert({
      where: { name: allergen.name },
      update: {},
      create: allergen,
    });
  }
    
  // Seed Categories (safe - won't duplicate)
  const categories = [
    { name: "Starter", description: "Begin your culinary journey", sortOrder: 1, isActive: true },
    { name: "Main Course", description: "Signature main courses", sortOrder: 2, isActive: true },
    { name: "Side Dish", description: "Perfect accompaniments", sortOrder: 3, isActive: true },
    { name: "Dessert", description: "Sweet endings", sortOrder: 4, isActive: true },
    { name: "Wine & Spirits", description: "Fine wines and spirits", sortOrder: 5, isActive: true },
    { name: "Specials", description: "Chef's special creations", sortOrder: 6, isActive: true },
  ];

  console.log('📝 Seeding categories...')
  for (const category of categories) {
    const result = await prisma.category.upsert({
      where: { name: category.name },
      update: {},  // won't change existing
      create: category,
    });
    console.log(`  ${result.name} - ${result.isActive ? 'Active' : 'Inactive'}`)
  }
  
  console.log('✅ Seeding complete! No duplicates created.')
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });