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

import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import com.independent.cardcodex.ui.util.EnergyIconProvider

enum class CodexCategory {
    All, Pokemon, Trainer, Energy
}

@HiltViewModel
class PokedexViewModel @Inject constructor(
    private val repository: ManifestRepository,
    private val cardDao: CardDao,
    private val energyIconProvider: EnergyIconProvider
) : ViewModel() {

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _selectedCategories = MutableStateFlow<Set<CodexCategory>>(setOf(CodexCategory.All))
    val selectedCategories: StateFlow<Set<CodexCategory>> = _selectedCategories.asStateFlow()

    val importProgress: StateFlow<ImportProgress> = repository.importProgress
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), ImportProgress.Idle)

    val codexEntries: StateFlow<List<CodexEntry>> = combine(
        cardDao.getAllSpecies(),
        cardDao.getUncategorizedCards(),
        _searchQuery,
        _selectedCategories
    ) { speciesList: List<SpeciesEntity>, uncategorizedList: List<CardEntity>, query: String, categories: Set<CodexCategory> ->
        val speciesEntries = speciesList.map { species ->
            CodexEntry(
                id = species.id.toString(),
                name = species.name,
                iconUrl = species.iconUrl,
                type = species.types.firstOrNull(),
                isSpecies = true,
                speciesId = species.id
            )
        }

        val otherEntries = uncategorizedList
            .groupBy { it.name }
            .map { (name, cards) ->
                val firstCard = cards.first()
                
                var iconUrl = firstCard.imageUrl
                if (firstCard.supertype == "Energy") {
                     val energyType = name.substringBefore(" Energy").trim()
                     iconUrl = energyIconProvider.getIconUrl(energyType) ?: firstCard.imageUrl
                }

                CodexEntry(
                    id = name,
                    name = name,
                    iconUrl = iconUrl,
                    type = firstCard.supertype ?: "Trainer",
                    isSpecies = false,
                    speciesId = null
                )
            }

        // Merge
        val allEntries = speciesEntries + otherEntries

        // Filter & Sort
        allEntries
            .filter { entry -> 
                (query.isBlank() || entry.name.contains(query, ignoreCase = true)) &&
                (categories.contains(CodexCategory.All) || 
                 categories.any { category ->
                    when (category) {
                        CodexCategory.Pokemon -> entry.isSpecies
                        CodexCategory.Trainer -> !entry.isSpecies && entry.type == "Trainer"
                        CodexCategory.Energy -> !entry.isSpecies && entry.type == "Energy"
                        else -> false // Should not happen with current categories
                    }
                 })
            }
            .sortedWith(compareBy<CodexEntry> { 
                // Sort Order: Pokemon (0) -> Trainer (1) -> Energy (2) -> Other (3)
                when {
                    it.isSpecies -> 0
                    it.type == "Trainer" -> 1
                    it.type == "Energy" -> 2
                    else -> 3
                }
            }.thenBy { 
                // Secondary Sort: ID for Pokemon, Name for others
                if (it.isSpecies) it.speciesId else 0 
            }.thenBy { 
                it.name 
            })

    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun onSearchQueryChange(query: String) {
        _searchQuery.value = query
    }

    fun onCategorySelect(category: CodexCategory) {
        _selectedCategories.value = if (category == CodexCategory.All) {
            setOf(CodexCategory.All)
        } else {
            val current = _selectedCategories.value.toMutableSet()
            if (current.contains(CodexCategory.All)) {
                current.remove(CodexCategory.All)
            }
            
            if (current.contains(category)) {
                current.remove(category)
            } else {
                current.add(category)
            }
            
            if (current.isEmpty()) {
                setOf(CodexCategory.All)
            } else {
                current
            }
        }
    }

    fun startImport(url: String) {
        viewModelScope.launch {
            repository.startImport(url)
        }
    }
}
