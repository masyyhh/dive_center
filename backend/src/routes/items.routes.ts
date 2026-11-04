import { Router } from 'express';
import { registerCatalogueBulkRoutes } from './catalogue.bulk';
import { registerCatalogueReadRoutes, registerCatalogueWriteRoutes } from './catalogue.items';
import { registerCatalogueTransferRoutes } from './catalogue.transfer';

export const itemsRouter = Router();

// Keep registration order explicit: static endpoints precede item ID mutations.
registerCatalogueBulkRoutes(itemsRouter);
registerCatalogueReadRoutes(itemsRouter);
registerCatalogueTransferRoutes(itemsRouter);
registerCatalogueWriteRoutes(itemsRouter);
