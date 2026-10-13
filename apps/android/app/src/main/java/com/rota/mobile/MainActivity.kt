package com.rota.mobile

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.rota.mobile.ui.HomeViewModel
import com.rota.mobile.ui.RotaApp
import com.rota.mobile.ui.appViewModelFactory
import com.rota.mobile.ui.theme.RotaTheme

class MainActivity : ComponentActivity() {

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        viewModel.onLocationPermissionResult(granted[Manifest.permission.ACCESS_FINE_LOCATION] == true)
    }

    // appViewModelFactory e uma factory comum, nao uma funcao @Composable.
    // O launcher de permissao vive como propriedade e dispara FORA da composicao,
    // onde nao se pode chamar composable — o compilador recusava.
    private val viewModel: HomeViewModel by viewModels { appViewModelFactory }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            RotaTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    RotaApp(
                        onRequestLocationPermission = { requestPermissions() },
                    )
                }
            }
        }

        // A permissao NAO e solicitada na primeira abertura: perguntamos quando a
        // jornada comecar (o rastreamento so faz sentido durante a jornada).
    }

    private fun requestPermissions() {
        val permissions = buildList {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Em segundo plano so e solicitada com justificativa explicita.
                add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        permissionLauncher.launch(permissions.toTypedArray())
    }
}
