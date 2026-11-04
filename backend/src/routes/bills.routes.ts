import { Router } from 'express';
import { registerBillReadRoutes } from './bill.read';
import { registerBillSaveRoutes } from './bill.save';
import { registerBillActionRoutes } from './bill.actions';

export const billsRouter = Router();

// Preserve static lookups, list/details, create/edit, then bill actions in order.
registerBillReadRoutes(billsRouter);
registerBillSaveRoutes(billsRouter);
registerBillActionRoutes(billsRouter);
