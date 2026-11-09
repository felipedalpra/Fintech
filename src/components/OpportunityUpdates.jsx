// Aba "Atualizações" da oportunidade (estilo Monday): comentários internos da equipe, com
// respostas e menções @nome. Fonte única: opportunity_notes (as mesmas notas da Timeline e da
// coluna Observações) — nada é misturado com as mensagens do WhatsApp.
// Novas atualizações chegam pelo Realtime, sem recarregar a página.
import { addNote } from '../lib/taskActions.js'
import { loadOpportunityUpdates } from '../lib/crmWorkspaceStore.js'
import { UpdatesThread } from './UpdatesThread.jsx'

export function OpportunityUpdates({ ownerId, opp, userId, members, onCountChange }) {
  const oppId = opp?.id
  return (
    <UpdatesThread
      threadKey={oppId}
      load={() => loadOpportunityUpdates(oppId)}
      save={(text, opts) => addNote(ownerId, oppId, text, userId, opts)}
      realtime={{ key: 'opp-updates', table: 'opportunity_notes', filter: `opportunity_id=eq.${oppId}` }}
      members={members}
      onCountChange={onCountChange}
    />
  )
}
