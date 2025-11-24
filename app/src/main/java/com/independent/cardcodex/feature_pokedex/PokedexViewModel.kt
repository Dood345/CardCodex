package com.independent.cardcodex.feature_pokedex

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.independent.cardcodex.core_database.CardDao
import com.independent.cardcodex.core_database.CardEntity
import com.independent.cardcodex.core_database.SpeciesEntity
import com.independent.cardcodex.data.ImportProgress
import com.independent.cardcodex.data.ManifestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PokedexViewModel @Inject constructor(
    private val repository: ManifestRepository,
    private val cardDao: CardDao
) : ViewModel() {

    val importProgress: StateFlow<ImportProgress> = repository.importProgress
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), ImportProgress.Idle)

    val allSpecies: StateFlow<List<SpeciesEntity>> = cardDao.getAllSpecies()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun startImport(url: String) {
        viewModelScope.launch {
            repository.startImport(url)
        }
    }

    fun getCardsForSpecies(speciesId: Int): Flow<List<CardEntity>> {
        return cardDao.getCardsForSpecies(speciesId)
    }
}
