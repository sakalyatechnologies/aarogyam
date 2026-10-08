package com.aarogyam.patient.android.ui

import androidx.compose.runtime.Composable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CoroutineScope

/** Keeps a shared state holder alive across configuration changes; its scope ends with the screen. */
class HolderViewModel<T : Any>(
    create: (CoroutineScope) -> T,
) : ViewModel() {
    val holder: T = create(viewModelScope)
}

/** The state holder for the current navigation destination, created once. */
@Composable
inline fun <reified T : Any> rememberHolder(noinline create: (CoroutineScope) -> T): T =
    viewModel(key = T::class.qualifiedName) { HolderViewModel(create) }.holder
