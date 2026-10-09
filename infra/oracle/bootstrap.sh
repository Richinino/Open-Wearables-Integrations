#!/bin/bash
# Krátky inicializačný skript pre Oracle. Stiahne user-data.sh z GitHubu
# (z pevného commitu, takže obsah sa nedá dodatočne zmeniť) a spustí ho.
# Vyplň dve hodnoty a celé to vlož do: Advanced options -> Management ->
# Initialization script -> Paste cloud-init script.
export OW_ADMIN_EMAIL='tvoj@email.sk'
export OW_ADMIN_PASSWORD='SEM-DAJ-SILNE-HESLO'
curl -fsSL --retry 10 --retry-all-errors -o /root/ow-setup.sh https://raw.githubusercontent.com/Richinino/Open-Wearables-Integrations/e90f84d20ceda64c5806935e22c4427e4b6610e6/infra/oracle/user-data.sh
bash /root/ow-setup.sh
