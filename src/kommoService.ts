import fetch from 'node-fetch';

export interface Lead {
    id: number;
    status_id: number;
    pipeline_id: number;
    [key: string]: any;
}

export interface Contact {
    id: number;
    name: string;
    leads: Lead[];
    [key: string]: any;
}

export class KommoService {
    private apiKey: string;
    private subdomain: string;

    constructor(apiKey: string, subdomain: string) {
        this.apiKey = apiKey;
        this.subdomain = subdomain;
    }

    // Método para buscar un contacto por teléfono y obtener sus leads asociados
    public async searchContactsByPhone(phoneNumber: string): Promise<Contact[]> {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${this.apiKey}`,
            },
        };

        const url = `https://${this.subdomain}.kommo.com/api/v4/contacts?with=leads&query=${phoneNumber}`;

        try {
            const response = await fetch(url, options);
            const data = await response.json();

            // Verificar que se encontraron contactos
            if (data._embedded && data._embedded.contacts && data._embedded.contacts.length > 0) {
                return data._embedded.contacts.map((contact: any) => ({
                    id: contact.id,
                    name: contact.name,
                    leads: contact._embedded.leads || [],
                }));
            }

            return [];
        } catch (error) {
            console.error('Error fetching contacts from Kommo:', error);
            return [];
        }
    }

    // Método para obtener los datos de un lead por su ID
    public async getLeadById(leadId: number): Promise<Lead | null> {
        const options = {
            method: 'GET',
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${this.apiKey}`,
            },
        };

        const url = `https://${this.subdomain}.kommo.com/api/v4/leads/${leadId}`;

        try {
            const response = await fetch(url, options);
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error fetching lead from Kommo:', error);
            return null;
        }
    }

    // Método para actualizar el status_id y el responsible_user_id de un lead
    public async updateLeadStatusAndUser(leadId: number, newStatusId: number, newResponsibleUserId: number): Promise<boolean> {
        const options = {
            method: 'PATCH',
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                status_id: newStatusId,
                responsible_user_id: newResponsibleUserId,
            }),
        };

        const url = `https://${this.subdomain}.kommo.com/api/v4/leads/${leadId}`;

        try {
            const response = await fetch(url, options);
            if (response.ok) {
                await this.createTaskForLead(leadId);
                return true;
            } else {
                console.error('Error updating lead:', response.statusText);
                return false;
            }
        } catch (error) {
            console.error('Error updating lead in Kommo:', error);
            return false;
        }
    }

    // Método para crear una tarea para el lead
    private async createTaskForLead(leadId: number): Promise<void> {
        const task = [
            {
                "task_type_id": 1,
                "text": "Atender a nuevo usuario",
                "complete_till": Math.floor(Date.now() / 1000) + 86400, // 24 horas desde ahora
                "entity_id": leadId,
                "entity_type": "leads",
                "request_id": "task_" + leadId
            }
        ];

        const optionsPostTask = {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Authorization': 'Bearer ' + this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(task)
        };

        const url = `https://${this.subdomain}.kommo.com/api/v4/tasks`;

        try {
            const response = await fetch(url, optionsPostTask);
            if (response.ok) {
                console.log(`Task created for lead ${leadId}`);
            } else {
                console.error('Error creating task:', response.statusText);
            }
        } catch (error) {
            console.error('Error creating task in Kommo:', error);
        }
    }

    // Método principal para el flujo completo
    public async processLeadsForPhone(phoneNumber: string, targetStatusId: number, targetPipelineId: number, newStatusId: number, newResponsibleUserId: number): Promise<void> {
        // Buscar contactos por teléfono
        const contacts = await this.searchContactsByPhone(phoneNumber);

        if (contacts.length === 0) {
            console.log('No se encontró ningún contacto con ese número de teléfono.');
            return;
        }

        // Iterar sobre todos los contactos y sus leads
        for (const contact of contacts) {
            for (const lead of contact.leads) {
                const leadData = await this.getLeadById(lead.id);

                if (leadData && leadData.status_id === targetStatusId && leadData.pipeline_id === targetPipelineId) {
                    // Actualizar el lead si cumple las condiciones
                    const updateSuccess = await this.updateLeadStatusAndUser(lead.id, newStatusId, newResponsibleUserId);

                    if (updateSuccess) {
                        console.log(`Lead con ID ${lead.id} del contacto ${contact.name} actualizado correctamente y tarea creada.`);
                        return; // Termina el proceso una vez que se actualiza un lead
                    } else {
                        console.log(`Error al actualizar el lead con ID ${lead.id} del contacto ${contact.name}.`);
                    }
                }
            }
        }

        console.log('No se encontró ningún lead que cumpla con los criterios especificados.');
    }
}
