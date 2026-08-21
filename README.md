server-run
```bash
npx nodemon --exec ts-node src/server.ts
/
npx nodemon src/server.ts
```

when change model of postgreSQL:
```bash
npx prisma generate
```

and then do migration :
```bash
npx prisma migrate dev --name add_menu_item
```

### seed run:
```bash
npx ts-node prisma/seed/seed.ts
```
