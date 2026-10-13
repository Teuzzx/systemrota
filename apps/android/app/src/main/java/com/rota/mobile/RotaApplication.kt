package com.rota.mobile

import android.app.Application
import com.rota.mobile.sync.SyncWorker

/**
 * Ponto unico de inicializacao.
 *
 * A sincronizacao periodica e agendada no boot: se o app for encerrado pelo
 * sistema ou o aparelho reiniciar, os eventos pendentes continuam na fila local
 * e sobem quando a conexao voltar.
 */
class RotaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        SyncWorker.init(this)
        SyncWorker.schedulePeriodic(this)
    }
}
