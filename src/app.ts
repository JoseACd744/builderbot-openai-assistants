import "dotenv/config";
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from '@builderbot/bot';
import { MemoryDB } from '@builderbot/bot';
import { BaileysProvider } from '@builderbot/provider-baileys';
import { toAsk, httpInject } from "@builderbot-plugins/openai-assistants";
import { typing } from "./utils/presence";
import { KommoService } from './kommoService';

const PORT = process.env.PORT ?? 3008;
const ASSISTANT_ID = process.env.ASSISTANT_ID ?? '';
const KOMMO_API_KEY = process.env.KOMMO_API_KEY ?? '';
const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN ?? '';

const kommoService = new KommoService(KOMMO_API_KEY, KOMMO_SUBDOMAIN);

const userQueues = new Map();
const userLocks = new Map();

const processUserMessage = async (ctx, { flowDynamic, state, provider }) => {
    console.log('Typing...');
    await typing(ctx, provider);
    console.log('Finished typing.');
    
    try {
        const response = await toAsk(ASSISTANT_ID, ctx.body, state);
        console.log('Response from OpenAI:', response);
    
        let shouldSendMessages = true;
    
        if (response.includes("¡Por supuesto! En un momento un asesor especializado se comunicará contigo para ayudarte.")) {
            const phoneNumber = ctx.from;
            const targetStatusId = 70275183;
            const targetPipelineId = 9013159;
            const newStatusId = 70275187;
            const newResponsibleUserId = 9295299;
    
            await kommoService.processLeadsForPhone(phoneNumber, targetStatusId, targetPipelineId, newStatusId, newResponsibleUserId);
    
            console.log(`No se enviarán más mensajes al número ${phoneNumber}`);
            shouldSendMessages = false;

            // Eliminar el número de userQueues y userLocks
            userQueues.delete(phoneNumber);
            userLocks.delete(phoneNumber);
        }
    
        if (shouldSendMessages) {
            const chunks = response.split(/\n\n+/);
            for (const chunk of chunks) {
                const cleanedChunk = chunk.trim().replace(/【.*?】[ ] /g, "");
                console.log('Sending chunk:', cleanedChunk);
                await flowDynamic([{ body: cleanedChunk }]);
            }
        }
    } catch (error) {
        console.error('Error processing user message:', error);
    }
};

const handleQueue = async (userId) => {
    const queue = userQueues.get(userId);

    if (userLocks.get(userId)) {
        return;
    }

    while (queue.length > 0) {
        userLocks.set(userId, true);
        const { ctx, flowDynamic, state, provider } = queue.shift();
        try {
            await processUserMessage(ctx, { flowDynamic, state, provider });
        } catch (error) {
            console.error(`Error processing message for user ${userId}:`, error);
        } finally {
            userLocks.set(userId, false);
        }
    }

    userLocks.delete(userId);
    userQueues.delete(userId);
};

const welcomeFlow = addKeyword<BaileysProvider, MemoryDB>(EVENTS.WELCOME)
    .addAction(async (ctx, { flowDynamic, state, provider }) => {
        const userId = ctx.from;

        const contactData = await kommoService.searchContactByPhone(userId);
        console.log('Contact data from Kommo:', contactData);

        if (!userQueues.has(userId)) {
            userQueues.set(userId, []);
        }

        const queue = userQueues.get(userId);
        queue.push({ ctx, flowDynamic, state, provider });

        if (!userLocks.get(userId) && queue.length === 1) {
            await handleQueue(userId);
        }
    });

const main = async () => {
    const adapterFlow = createFlow([welcomeFlow]);

    const adapterProvider = createProvider(BaileysProvider, {
        groupsIgnore: true,
        readStatus: false,
        presenceUpdate: false,
    });


    const adapterDB = new MemoryDB();

    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    httpInject(adapterProvider.server);
    httpServer(+PORT);
};

main();