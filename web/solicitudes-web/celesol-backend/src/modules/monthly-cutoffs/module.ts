import { prisma } from "../../db/prisma";
import { MonthlyCutoffService } from "./domain";
import { PrismaCutoffRepository } from "./PrismaCutoffRepository";
export const monthlyCutoffs = new MonthlyCutoffService(
  new PrismaCutoffRepository(prisma),
);
