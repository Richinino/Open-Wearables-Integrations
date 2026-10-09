#!/bin/bash
# Krátky inicializačný skript pre Oracle. Stiahne user-data.sh z GitHubu
# (z pevného commitu, takže obsah sa nedá dodatočne zmeniť) a spustí ho.
# Vyplň tri hodnoty a celé to vlož do: Advanced options -> Management ->
# Initialization script -> Paste cloud-init script.
export OW_TS_AUTHKEY='tskey-auth-SEM-VLOZ-KLUC'
export OW_ADMIN_EMAIL='tvoj@email.sk'
export OW_ADMIN_PASSWORD='SEM-DAJ-SILNE-HESLO'
curl -fsSL --retry 10 --retry-all-errors -o /root/ow-setup.sh https://raw.githubusercontent.com/Richinino/Open-Wearables-Integrations/103224edbd6149fd9ba42a1a0c6a94569fc8bc46/infra/oracle/user-data.sh
bash /root/ow-setup.sh
